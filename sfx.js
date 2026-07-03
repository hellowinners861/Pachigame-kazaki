/* ============================================================
   sfx.js - 甘雨パチンコ 効果音モジュール(璃月風)
   要素: 五音音階(C D E G A) / 古箏pluck / 梵鐘bell / 氷晶shimmer
   script.js より先に読み込むこと。
   音色調整は各効果音の freq / dur / vol の数値をいじればOK。
   ============================================================ */

"use strict";

const SFX = (() => {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null, master = null;

  /* iOSは初回タップまで音が出せないため、ボタン操作時にunlock()を呼ぶ */
  function ac() {
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.6;          // 全体音量(0〜1)
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  /* 五音音階(中国風ペンタトニック) C5から2オクターブ */
  const P = [523.25, 587.33, 659.25, 783.99, 880,
             1046.5, 1174.7, 1318.5, 1568, 1760];

  /* --- 基本部品: 単音 --- */
  function tone({ freq = 440, end, type = "sine", dur = 0.2, vol = 0.25, delay = 0, attack = 0.01 }) {
    const c = ac(), t0 = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (end && end !== freq) o.frequency.exponentialRampToValueAtTime(Math.max(end, 1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  /* --- 基本部品: ノイズ --- */
  function noise({ dur = 0.15, vol = 0.25, delay = 0, filter = 2000, ftype = "lowpass" }) {
    const c = ac(), t0 = c.currentTime + delay;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = ftype; f.frequency.value = filter;
    const g = c.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t0);
  }

  /* --- 古箏風の爪弾き --- */
  function pluck({ freq, dur = 0.5, vol = 0.2, delay = 0 }) {
    const c = ac(), t0 = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(freq * 1.008, t0);
    o.frequency.exponentialRampToValueAtTime(freq, t0 + 0.06);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
    noise({ dur: 0.03, vol: vol * 0.35, delay, filter: 5000, ftype: "highpass" });
  }

  /* --- 梵鐘: 非整数倍音を重ねる --- */
  function bell({ freq, dur = 1.6, vol = 0.18, delay = 0 }) {
    [[1, 1], [2.0, 0.55], [2.76, 0.35], [5.4, 0.18]].forEach(([m, a]) => {
      tone({ freq: freq * m, type: "sine", dur: dur / (1 + m * 0.25),
             vol: vol * a, delay, attack: 0.004 });
    });
  }

  /* --- 氷晶シマー --- */
  function shimmer({ n = 6, vol = 0.07, delay = 0 }) {
    for (let i = 0; i < n; i++) {
      const f = P[5 + Math.floor(Math.random() * 5)] * 2;
      tone({ freq: f, type: "sine", dur: 0.4, vol,
             delay: delay + i * 0.06 + Math.random() * 0.04, attack: 0.02 });
    }
  }

  /* ============ 効果音定義 ============ */
  return {
    /* iOSの音声制限解除(ユーザー操作時に呼ぶ) */
    unlock() { ac(); },
    setVolume(v) { ac(); master.gain.value = v; },

    hold() { pluck({ freq: P[7], dur: 0.35, vol: 0.2 }); },

    reelStop() {
      tone({ freq: 150, end: 70, type: "sine", dur: 0.09, vol: 0.28 });
      noise({ dur: 0.04, vol: 0.14, filter: 2500 });
    },

    payout() {
      bell({ freq: P[9] * 2, dur: 0.35, vol: 0.08 });
      bell({ freq: P[8] * 2, dur: 0.3, vol: 0.06, delay: 0.05 });
    },

    lose() {
      pluck({ freq: P[2], dur: 0.3, vol: 0.08 });
      pluck({ freq: P[0], dur: 0.4, vol: 0.07, delay: 0.16 });
    },

    yokoku() {
      bell({ freq: P[8], dur: 0.9, vol: 0.14 });
      shimmer({ n: 3, vol: 0.05, delay: 0.08 });
    },

    yokokuHot() {
      tone({ freq: 95, end: 36, type: "sine", dur: 0.55, vol: 0.5 });
      noise({ dur: 0.3, vol: 0.3, filter: 800 });
      bell({ freq: 220, dur: 1.6, vol: 0.22, delay: 0.05 });
    },

    alertRed() {
      for (let i = 0; i < 6; i++)
        pluck({ freq: P[0] / 2, dur: 0.15, vol: 0.2, delay: i * 0.11 });
      tone({ freq: 620, end: 880, type: "sawtooth", dur: 0.3, vol: 0.07, delay: 0.3 });
    },

    pseudo() {
      tone({ freq: 130, end: 42, type: "sine", dur: 0.4, vol: 0.45 });
      noise({ dur: 0.22, vol: 0.25, filter: 700 });
      P.slice(0, 8).forEach((f, i) =>
        pluck({ freq: f, dur: 0.22, vol: 0.1, delay: 0.32 + i * 0.05 }));
    },

    reach() {
      [0, 2, 4, 5, 7, 9].forEach((n, i) =>
        pluck({ freq: P[n], dur: 0.25, vol: 0.15, delay: i * 0.09 }));
      tone({ freq: P[0] / 2, type: "sawtooth", dur: 1.0, vol: 0.05, delay: 0.55, attack: 0.3 });
      tone({ freq: P[0] / 2 * 1.5, type: "sawtooth", dur: 1.0, vol: 0.04, delay: 0.55, attack: 0.3 });
    },

    blackout() {
      bell({ freq: 98, dur: 2.4, vol: 0.4 });
      tone({ freq: 49, end: 32, type: "sine", dur: 1.4, vol: 0.35, attack: 0.05 });
    },

    cutin() {
      noise({ dur: 0.18, vol: 0.26, filter: 4500, ftype: "highpass" });
      tone({ freq: 2200, end: 3600, type: "sawtooth", dur: 0.12, vol: 0.08 });
      pluck({ freq: P[5], dur: 0.4, vol: 0.18, delay: 0.1 });
    },

    cutinGold() {
      noise({ dur: 0.18, vol: 0.26, filter: 4500, ftype: "highpass" });
      bell({ freq: P[5], dur: 1.2, vol: 0.2, delay: 0.08 });
      shimmer({ n: 7, vol: 0.08, delay: 0.15 });
    },

    button() {
      tone({ freq: 170, end: 55, type: "sine", dur: 0.3, vol: 0.45 });
      noise({ dur: 0.18, vol: 0.28, filter: 1000 });
    },

    ikigeki() {
      bell({ freq: 130, dur: 2.6, vol: 0.4 });
      tone({ freq: 65, end: 30, type: "sine", dur: 1.0, vol: 0.5 });
      noise({ dur: 0.3, vol: 0.25, filter: 700 });
      shimmer({ n: 5, vol: 0.06, delay: 0.4 });
    },

    jackpot() {
      P.forEach((f, i) => pluck({ freq: f, dur: 0.25, vol: 0.13, delay: i * 0.05 }));
      bell({ freq: P[5], dur: 1.8, vol: 0.2, delay: 0.55 });
      bell({ freq: P[7], dur: 1.8, vol: 0.16, delay: 0.6 });
      bell({ freq: P[9], dur: 1.8, vol: 0.13, delay: 0.65 });
      shimmer({ n: 8, vol: 0.07, delay: 0.7 });
    },

    premium() {
      P.forEach((f, i) => pluck({ freq: f, dur: 0.22, vol: 0.12, delay: i * 0.045 }));
      [...P].reverse().forEach((f, i) =>
        pluck({ freq: f, dur: 0.22, vol: 0.1, delay: 0.5 + i * 0.045 }));
      bell({ freq: 130, dur: 3.0, vol: 0.35, delay: 1.0 });
      bell({ freq: P[5], dur: 2.2, vol: 0.18, delay: 1.05 });
      bell({ freq: P[9], dur: 2.2, vol: 0.14, delay: 1.1 });
      shimmer({ n: 12, vol: 0.08, delay: 1.15 });
      tone({ freq: 65, end: 38, type: "sine", dur: 1.4, vol: 0.35, delay: 1.0 });
    },

    rushIn() {
      [0, 2, 4, 5, 7, 9].forEach((n, i) =>
        pluck({ freq: P[n], dur: 0.28, vol: 0.16, delay: i * 0.09 }));
      bell({ freq: P[7], dur: 1.4, vol: 0.18, delay: 0.6 });
      shimmer({ n: 6, vol: 0.07, delay: 0.65 });
    },

    rushEnd() {
      [9, 7, 5, 4, 2, 0].forEach((n, i) =>
        pluck({ freq: P[n], dur: 0.6, vol: 0.13, delay: i * 0.3 }));
      bell({ freq: P[0], dur: 2.0, vol: 0.1, delay: 1.8 });
    },
  };
})();
