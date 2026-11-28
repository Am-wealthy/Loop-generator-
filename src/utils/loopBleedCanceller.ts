export interface AcousticDelayEstimate {
  hasBleed: boolean;
  delaySamples: number;
  correlation: number;
  estimatedBleedGain: number;
}

export interface LoopBleedCancelResult {
  cleanPcm: Float32Array;
  bleedCancelled: boolean;
  delaySamples: number;
  correlation: number;
  bleedReductionDb: number;
}

export function computeRms(buf: Float32Array, start = 0, end = buf.length): number {
  const s = Math.max(0, start);
  const e = Math.min(buf.length, end);
  const len = e - s;
  if (len <= 0) return 0;
  let sumSq = 0;
  for (let i = s; i < e; i++) {
    const v = buf[i];
    sumSq += v * v;
  }
  return Math.sqrt(sumSq / len);
}

/**
 * Estimates the causal acoustic + audio-output delay [0 .. maxDelayMs] between
 * the reference loop signal played to speakers and the microphone recording.
 * If correlation is near zero (e.g. user is wearing headphones or loop is muted),
 * returns `hasBleed: false` so clean vocal audio is never altered.
 */
export function estimateAcousticDelaySamples(
  micPcm: Float32Array,
  refPcm: Float32Array,
  sampleRate: number,
  maxDelayMs = 220
): AcousticDelayEstimate {
  const len = Math.min(micPcm.length, refPcm.length);
  if (len < 512) {
    return { hasBleed: false, delaySamples: 0, correlation: 0, estimatedBleedGain: 0 };
  }

  const refRms = computeRms(refPcm, 0, len);
  const micRms = computeRms(micPcm, 0, len);
  if (refRms < 0.002 || micRms < 0.001) {
    return { hasBleed: false, delaySamples: 0, correlation: 0, estimatedBleedGain: 0 };
  }

  // Analyze up to first 6 seconds where lead-in / gaps reveal speaker delay crisply
  const analyzeLen = Math.min(len, Math.floor(sampleRate * 6));
  const maxDelay = Math.min(
    Math.floor((maxDelayMs / 1000) * sampleRate),
    Math.floor(analyzeLen * 0.45)
  );
  if (maxDelay < 16) {
    return { hasBleed: false, delaySamples: 0, correlation: 0, estimatedBleedGain: 0 };
  }

  const stride = 4;
  let bestDelay = 0;
  let bestAbsCorr = 0;
  let bestSignedGain = 0;

  // Coarse sweep (step 4 samples)
  for (let d = 0; d <= maxDelay; d += stride) {
    let dot = 0;
    let micSq = 0;
    let refSq = 0;
    for (let i = d; i < analyzeLen; i += 2) {
      const m = micPcm[i];
      const r = refPcm[i - d];
      dot += m * r;
      micSq += m * m;
      refSq += r * r;
    }
    const denom = Math.sqrt(micSq * refSq);
    if (denom > 1e-8) {
      const corr = Math.abs(dot) / denom;
      if (corr > bestAbsCorr) {
        bestAbsCorr = corr;
        bestDelay = d;
        bestSignedGain = refSq > 1e-8 ? dot / refSq : 0;
      }
    }
  }

  // Fine sample-accurate refinement around coarse peak
  const fineStart = Math.max(0, bestDelay - stride - 2);
  const fineEnd = Math.min(maxDelay, bestDelay + stride + 2);
  for (let d = fineStart; d <= fineEnd; d++) {
    let dot = 0;
    let micSq = 0;
    let refSq = 0;
    for (let i = d; i < analyzeLen; i++) {
      const m = micPcm[i];
      const r = refPcm[i - d];
      dot += m * r;
      micSq += m * m;
      refSq += r * r;
    }
    const denom = Math.sqrt(micSq * refSq);
    if (denom > 1e-8) {
      const corr = Math.abs(dot) / denom;
      if (corr > bestAbsCorr) {
        bestAbsCorr = corr;
        bestDelay = d;
        bestSignedGain = refSq > 1e-8 ? dot / refSq : 0;
      }
    }
  }

  // Headphone isolation typically yields correlation < 0.06; speaker bleed > 0.10
  const hasBleed = bestAbsCorr >= 0.095 && Math.abs(bestSignedGain) >= 0.015;
  return {
    hasBleed,
    delaySamples: bestDelay,
    correlation: Number(bestAbsCorr.toFixed(4)),
    estimatedBleedGain: Math.max(-2.5, Math.min(2.5, bestSignedGain)),
  };
}

/**
 * Cancels loudspeaker loop bleed from a vocal microphone recording using a
 * double-talk-protected Delay-Aligned Normalized LMS (NLMS) adaptive filter.
 * - If headphones are used (`hasBleed === false`), returns clean untouched mic PCM.
 * - During active singing/humming ("double-talk"), filter adaptation slows/freezes
 *   so vocal harmonics are never hollowed out or disrupted.
 * - After subtracting the adaptive acoustic room impulse response, softly attenuates
 *   only unvoiced loop residue in silent gaps between hummed notes.
 */
export function isolateCleanVocalFromLoopBleed(
  micPcm: Float32Array,
  refPcm: Float32Array | null | undefined,
  sampleRate: number
): LoopBleedCancelResult {
  if (micPcm.length === 0) {
    return {
      cleanPcm: new Float32Array(0),
      bleedCancelled: false,
      delaySamples: 0,
      correlation: 0,
      bleedReductionDb: 0,
    };
  }

  if (!refPcm || refPcm.length < 256) {
    return {
      cleanPcm: new Float32Array(micPcm),
      bleedCancelled: false,
      delaySamples: 0,
      correlation: 0,
      bleedReductionDb: 0,
    };
  }

  const alignedLen = Math.min(micPcm.length, refPcm.length);
  const estimate = estimateAcousticDelaySamples(micPcm, refPcm, sampleRate);

  if (!estimate.hasBleed) {
    return {
      cleanPcm: new Float32Array(micPcm),
      bleedCancelled: false,
      delaySamples: estimate.delaySamples,
      correlation: estimate.correlation,
      bleedReductionDb: 0,
    };
  }

  // 64-tap room IR window centered slightly ahead of estimated direct delay
  const numTaps = 64;
  const baseDelay = Math.max(0, estimate.delaySamples - 12);
  const weights = new Float64Array(numTaps);
  const seedTap = Math.min(numTaps - 1, Math.max(0, estimate.delaySamples - baseDelay));
  weights[seedTap] = estimate.estimatedBleedGain * 0.7;

  const eps = 1e-4;
  const winSamples = Math.max(64, Math.floor(sampleRate * 0.01)); // 10ms RMS windows

  // Pass 1: Adapt room echo filter weights (slower mu during double-talk vocal frames)
  for (let pass = 0; pass < 2; pass++) {
    for (let blockStart = 0; blockStart < alignedLen; blockStart += winSamples) {
      const blockEnd = Math.min(alignedLen, blockStart + winSamples);

      // Compute block RMS of mic vs ref to detect vocal double-talk
      let mSq = 0;
      let rSq = 0;
      for (let i = blockStart; i < blockEnd; i++) {
        const mv = micPcm[i];
        mSq += mv * mv;
        const rIdx = i - estimate.delaySamples;
        const rv = rIdx >= 0 ? refPcm[rIdx] : 0;
        rSq += rv * rv;
      }
      const blockMicRms = Math.sqrt(mSq / Math.max(1, blockEnd - blockStart));
      const blockRefRms = Math.sqrt(rSq / Math.max(1, blockEnd - blockStart));
      const expectedBleedRms = blockRefRms * Math.max(0.05, Math.abs(estimate.estimatedBleedGain));

      // Double-talk detector: if mic is substantially louder than expected bleed, user is singing!
      const isDoubleTalk = blockMicRms > expectedBleedRms * 1.9 + 0.012;
      const mu = isDoubleTalk ? 0.025 : pass === 0 ? 0.42 : 0.16;

      for (let i = blockStart; i < blockEnd; i++) {
        let yHat = 0;
        let power = eps;
        for (let k = 0; k < numTaps; k++) {
          const rIdx = i - baseDelay - k;
          if (rIdx >= 0) {
            const rk = refPcm[rIdx];
            yHat += weights[k] * rk;
            power += rk * rk;
          }
        }
        const err = micPcm[i] - yHat;
        const step = (mu * err) / power;
        for (let k = 0; k < numTaps; k++) {
          const rIdx = i - baseDelay - k;
          if (rIdx >= 0) {
            weights[k] += step * refPcm[rIdx];
            // Clamp filter coefficients against divergence
            if (weights[k] > 3.0) weights[k] = 3.0;
            else if (weights[k] < -3.0) weights[k] = -3.0;
          }
        }
      }
    }
  }

  // Pass 2: Clean linear subtraction using locked room IR + residual loop-only tail damper
  const cleanOut = new Float32Array(micPcm.length);
  let bleedEnergyBefore = 0;
  let bleedEnergyAfter = 0;

  let envClean = 0;
  let envPred = 0;
  const envCoeff = Math.exp(-1 / (sampleRate * 0.015));
  let smoothGateGain = 1.0;
  const gateSmooth = Math.exp(-1 / (sampleRate * 0.012));

  for (let i = 0; i < micPcm.length; i++) {
    if (i >= alignedLen) {
      cleanOut[i] = micPcm[i];
      continue;
    }

    let yHat = 0;
    for (let k = 0; k < numTaps; k++) {
      const rIdx = i - baseDelay - k;
      if (rIdx >= 0) {
        yHat += weights[k] * refPcm[rIdx];
      }
    }

    const residual = micPcm[i] - yHat;
    envClean = envCoeff * envClean + (1 - envCoeff) * residual * residual;
    envPred = envCoeff * envPred + (1 - envCoeff) * yHat * yHat;

    const cleanRms = Math.sqrt(Math.max(0, envClean));
    const predRms = Math.sqrt(Math.max(0, envPred));

    // Only gently attenuate residual room reverb when NO voice is present over predicted bleed
    let targetGate = 1.0;
    if (predRms > 0.006 && cleanRms < predRms * 0.85) {
      targetGate = 0.14;
      bleedEnergyBefore += micPcm[i] * micPcm[i];
      bleedEnergyAfter += residual * residual * 0.14 * 0.14;
    } else {
      bleedEnergyBefore += yHat * yHat;
    }

    smoothGateGain = gateSmooth * smoothGateGain + (1 - gateSmooth) * targetGate;
    cleanOut[i] = Math.max(-0.98, Math.min(0.98, residual * smoothGateGain));
  }

  const reductionDb =
    bleedEnergyAfter > 1e-10 && bleedEnergyBefore > bleedEnergyAfter
      ? Math.min(36, 10 * Math.log10(bleedEnergyBefore / bleedEnergyAfter))
      : estimate.hasBleed
      ? 14
      : 0;

  return {
    cleanPcm: cleanOut,
    bleedCancelled: true,
    delaySamples: estimate.delaySamples,
    correlation: estimate.correlation,
    bleedReductionDb: Number(reductionDb.toFixed(1)),
  };
}

/**
 * Lightweight real-time block bleed estimator + canceller used during live pitch
 * detection so loudspeaker percussion/loop notes don't trigger false notes in the track.
 */
export class RealTimeLoopBleedCanceller {
  private refRing: Float32Array;
  private refWritePos = 0;
  private sampleRate: number;
  private maxDelaySamples: number;
  private estimatedDelay = 0;
  private estimatedGain = 0;
  private bleedDetected = false;
  private weights: Float64Array;
  private readonly numTaps = 32;

  constructor(sampleRate: number, maxDelayMs = 200) {
    this.sampleRate = Math.max(8000, sampleRate);
    this.maxDelaySamples = Math.max(128, Math.floor((maxDelayMs / 1000) * this.sampleRate));
    this.refRing = new Float32Array(this.maxDelaySamples + 8192);
    this.weights = new Float64Array(this.numTaps);
  }

  public reset(): void {
    this.refRing.fill(0);
    this.refWritePos = 0;
    this.estimatedDelay = 0;
    this.estimatedGain = 0;
    this.bleedDetected = false;
    this.weights.fill(0);
  }

  private readRefLag(samplesAgo: number): number {
    const ringLen = this.refRing.length;
    const idx = (((this.refWritePos - 1 - samplesAgo) % ringLen) + ringLen) % ringLen;
    return this.refRing[idx];
  }

  /**
   * Processes one live synchronous block pair (micBlock, refBlock) and returns a
   * bleed-cleaned Float32Array plus whether this block appears to be pure loop bleed.
   */
  public processLiveBlock(
    micBlock: Float32Array,
    refBlock: Float32Array | null | undefined
  ): { cleanBlock: Float32Array; isPureLoopBleed: boolean; hasLoopRef: boolean } {
    const n = micBlock.length;
    if (!refBlock || refBlock.length === 0 || n === 0) {
      return { cleanBlock: micBlock, isPureLoopBleed: false, hasLoopRef: false };
    }

    const ringLen = this.refRing.length;
    const refRms = computeRms(refBlock);
    const micRms = computeRms(micBlock);

    // Push current reference samples first
    const copyLen = Math.min(n, refBlock.length);
    for (let i = 0; i < copyLen; i++) {
      this.refRing[this.refWritePos] = refBlock[i];
      this.refWritePos = (this.refWritePos + 1) % ringLen;
    }

    if (refRms < 0.0025) {
      return { cleanBlock: micBlock, isPureLoopBleed: false, hasLoopRef: false };
    }

    // Periodically lock causal speaker-to-mic delay across recent ring when ref is strong
    if (micRms > 0.002 && refRms > 0.004) {
      const searchMax = Math.min(this.maxDelaySamples, Math.floor(0.18 * this.sampleRate));
      let bestD = this.estimatedDelay;
      let bestCorr = 0;
      let bestGain = this.estimatedGain;

      for (let d = 0; d <= searchMax; d += 8) {
        let dot = 0;
        let mSq = 0;
        let rSq = 0;
        for (let i = 0; i < n; i += 4) {
          const mv = micBlock[i];
          const rv = this.readRefLag(n - 1 - i + d);
          dot += mv * rv;
          mSq += mv * mv;
          rSq += rv * rv;
        }
        const den = Math.sqrt(mSq * rSq);
        if (den > 1e-8) {
          const corr = Math.abs(dot) / den;
          if (corr > bestCorr) {
            bestCorr = corr;
            bestD = d;
            bestGain = rSq > 1e-8 ? dot / rSq : 0;
          }
        }
      }

      if (bestCorr >= 0.24 && Math.abs(bestGain) >= 0.02) {
        this.estimatedDelay = bestD;
        this.estimatedGain = this.bleedDetected
          ? this.estimatedGain * 0.65 + bestGain * 0.35
          : bestGain;
        this.bleedDetected = true;
      }
    }

    if (!this.bleedDetected) {
      return { cleanBlock: micBlock, isPureLoopBleed: false, hasLoopRef: true };
    }

    // Fast double-talk-aware adaptive subtraction on the live block
    const cleanOut = new Float32Array(n);
    const baseDelay = Math.max(0, this.estimatedDelay - 8);
    const expectedBleedRms = refRms * Math.max(0.05, Math.abs(this.estimatedGain));
    const isDoubleTalk = micRms > expectedBleedRms * 1.9 + 0.014;
    const mu = isDoubleTalk ? 0.02 : 0.32;
    const eps = 1e-4;

    let cleanSq = 0;
    for (let i = 0; i < n; i++) {
      let yHat = 0;
      let pow = eps;
      for (let k = 0; k < this.numTaps; k++) {
        const rv = this.readRefLag(n - 1 - i + baseDelay + k);
        yHat += this.weights[k] * rv;
        pow += rv * rv;
      }
      const err = micBlock[i] - yHat;
      cleanOut[i] = err;
      cleanSq += err * err;

      const step = (mu * err) / pow;
      for (let k = 0; k < this.numTaps; k++) {
        const rv = this.readRefLag(n - 1 - i + baseDelay + k);
        this.weights[k] = Math.max(-3, Math.min(3, this.weights[k] + step * rv));
      }
    }

    const cleanRms = Math.sqrt(cleanSq / n);
    // Pure bleed when after echo subtraction RMS fell near noise floor / below expected bleed
    const isPureLoopBleed =
      !isDoubleTalk &&
      cleanRms < Math.max(0.011, expectedBleedRms * 0.95) &&
      micRms < expectedBleedRms * 1.55 + 0.012;

    return { cleanBlock: cleanOut, isPureLoopBleed, hasLoopRef: true };
  }
}

/**
 * Normalizes isolated vocal audio gently so natural quiet humming is clearly audible
 * without boosting silent background noise floors.
 */
export function polishCleanHumBuffer(
  pcm: Float32Array,
  sampleRate: number
): Float32Array {
  const n = pcm.length;
  if (n === 0) return new Float32Array(0);

  let peak = 0;
  let activeSq = 0;
  let activeCount = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(pcm[i]);
    if (a > peak) peak = a;
    if (a > 0.01) {
      activeSq += pcm[i] * pcm[i];
      activeCount++;
    }
  }
  if (peak < 1e-4) return new Float32Array(n);

  const activeRms = activeCount > 0 ? Math.sqrt(activeSq / activeCount) : peak * 0.5;
  const targetGain = Math.min(3.2, Math.min(0.88 / peak, 0.24 / Math.max(0.02, activeRms)));
  const out = new Float32Array(n);

  const fadeFrames = Math.min(Math.floor(sampleRate * 0.008), Math.floor(n / 4));
  for (let i = 0; i < n; i++) {
    let val = Math.tanh(pcm[i] * targetGain) * 0.94;
    if (i < fadeFrames) val *= i / fadeFrames;
    else if (i >= n - fadeFrames) val *= (n - 1 - i) / fadeFrames;
    out[i] = val;
  }
  return out;
}
