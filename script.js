/* ============================================================
   NEON CAT PACHI - script.js
   構成(すべてこのファイル内でモジュール化):
     1. CONFIG   … 確率・タイミング・出玉を一元管理
     2. ASSETS   … 画像差し替えポイント
     3. Utils    … 乱数ユーティリティ
     4. TABLES   … 演出テーブル(保留色・変動パターン)
     5. Reels    … 図柄リール制御
     6. FX       … 汎用エフェクト(フラッシュ・揺れ・ランプ)
     7. Director … 変動演出の再生(タイムライン方式)
     8. Game     … 状態管理・抽選・大当り・RUSH/ST
     9. Input    … 発射ボタン・自動プレイ・キーボード
   演出を増やす場合は TABLES にパターンを追加するだけでOK。
   ============================================================ */

"use strict";

/* ============ 1. CONFIG(確率・数値の一元管理) ============ */
const CONFIG = {
  lottery: {
    normalProb: 1 / 319,   // 通常時 大当り確率
    stProb:     1 / 99,    // ST中 大当り確率
    rushEntry:  0.60,      // 初当り時のRUSH突入率
    stSpins:    160,       // ST回転数 → 継続率 ≒ 1-(98/99)^160 ≒ 80%
  },
  payout: {
    normalRounds: 4,       // 通常当り(RUSH非突入)ラウンド数
    rushRounds:   10,      // RUSH当りラウンド数
    ballsPerRound: 140,    // 1Rあたりの出玉
    startPay: 3,           // スタート入賞時の払い出し
  },
  launch: {
    interval: 110,         // 発射間隔(ms)
    startRate: 0.14,       // スタート入賞率
    initialBalls: 1000,
  },
  timing: {                // ラウンド消化などの表示テンポ(ms)
    roundTick: 650,
    jackpotBanner: 2200,
    rushEndBanner: 2400,
  },
};

/* ============ 2. ASSETS(画像差し替えポイント) ============
   画像を用意したらパスを入れるだけで反映されます。
   例: lcdBg: "images/bg_normal.png"
   空文字のときはCSSのグラデーション/絵文字を使用。       */
const ASSETS = {
  lcdBg:      "",   // 液晶背景
  lcdBgRush:  "",   // RUSH中背景
  character:  "",   // キャラクター画像(空なら🐱)
  cutinImg:   "",   // カットイン画像(拡張用)
};

/* ============ 3. Utils ============ */
const rand = () => Math.random();
const chance = (p) => rand() < p;
const pickInt = (n) => Math.floor(rand() * n);

/** 重み付き抽選: [{w: 数値, ...}, ...] から1つ選ぶ */
function weightedPick(list) {
  const total = list.reduce((s, e) => s + e.w, 0);
  let r = rand() * total;
  for (const e of list) { r -= e.w; if (r <= 0) return e; }
  return list[list.length - 1];
}

/* ============ 4. TABLES(演出テーブル) ============ */

/* --- 保留色(先読み)テーブル: 当落で振り分けを変える --- */
const HOLD_COLOR_TABLE = {
  lose: [
    { w: 90,  color: "white"   },
    { w: 7,   color: "blue"    },
    { w: 2.5, color: "green"   },
    { w: 0.5, color: "red"     },
    // ハズレで虹は出ない(虹=大当り確定)
  ],
  win: [
    { w: 25, color: "white"   },
    { w: 20, color: "blue"    },
    { w: 22, color: "green"   },
    { w: 28, color: "red"     },
    { w: 5,  color: "rainbow" },
  ],
};

/* --- 変動パターン定義 ---
   演出を追加したいときはここにオブジェクトを足すだけ。
   フィールド:
     w        … 選択率(重み)
     reach    … リーチになるか
     sp       … 0:なし 1:SP弱 2:SP強
     dur      … 変動全体の長さ(ms)
     yokoku   … 予告演出の配列 [{at(ms), text, cls}]
     cutin    … カットイン {at, text, gold}
     revival  … 一度ハズレ→復活当り
     premium  … プレミア(当り確定演出)
*/
const PATTERNS = {
  /* ===== 通常時・ハズレ ===== */
  normalLose: [
    { w: 52, name: "即ハズレ",     reach: false, sp: 0, dur: 3600 },
    { w: 22, name: "弱予告ハズレ", reach: false, sp: 0, dur: 4800,
      yokoku: [{ at: 900, text: "ん…?", cls: "" }] },
    { w: 14, name: "Nリーチハズレ", reach: true, sp: 0, dur: 9000 },
    { w: 8,  name: "SP弱ハズレ",   reach: true, sp: 1, dur: 14000,
      yokoku: [{ at: 1000, text: "チャンス!?", cls: "" }],
      cutin: { at: 9500, text: "ネコパンチ!", gold: false } },
    { w: 3.5, name: "SP強ハズレ",  reach: true, sp: 2, dur: 18500,
      yokoku: [{ at: 900, text: "ネコ群出現!!", cls: "hot" }],
      cutin: { at: 12500, text: "覚醒カットイン", gold: false } },
    { w: 0.5, name: "激アツハズレ", reach: true, sp: 2, dur: 20000,
      yokoku: [{ at: 900, text: "ネコ群出現!!", cls: "hot" },
               { at: 5000, text: "激アツ!!", cls: "hot" }],
      cutin: { at: 14000, text: "金カットイン!!", gold: true } },
  ],

  /* ===== 通常時・当り ===== */
  normalWin: [
    { w: 6,  name: "Nリーチ当り", reach: true, sp: 0, dur: 9500 },
    { w: 20, name: "SP弱当り",   reach: true, sp: 1, dur: 14500,
      yokoku: [{ at: 1000, text: "チャンス!?", cls: "" }],
      cutin: { at: 9500, text: "ネコパンチ!", gold: false } },
    { w: 38, name: "SP強当り",   reach: true, sp: 2, dur: 19000,
      yokoku: [{ at: 900, text: "ネコ群出現!!", cls: "hot" }],
      cutin: { at: 12500, text: "覚醒カットイン", gold: true } },
    { w: 22, name: "激アツ当り", reach: true, sp: 2, dur: 20500,
      yokoku: [{ at: 900, text: "ネコ群出現!!", cls: "hot" },
               { at: 5000, text: "激アツ!!", cls: "hot" }],
      cutin: { at: 14000, text: "金カットイン!!", gold: true } },
    { w: 8,  name: "復活当り",   reach: true, sp: 1, dur: 15000, revival: true,
      yokoku: [{ at: 1000, text: "チャンス!?", cls: "" }] },
    { w: 6,  name: "プレミア全回転", reach: true, sp: 2, dur: 12000, premium: true,
      yokoku: [{ at: 1200, text: "★ PREMIUM ★", cls: "rainbow" }] },
  ],

  /* ===== RUSH中(テンポ重視の短時間パターン) ===== */
  rushLose: [
    { w: 70, name: "RUSH即ハズレ", reach: false, sp: 0, dur: 2200 },
    { w: 22, name: "RUSH煽り",     reach: false, sp: 0, dur: 3200,
      yokoku: [{ at: 600, text: "!?", cls: "" }] },
    { w: 8,  name: "RUSHリーチハズレ", reach: true, sp: 1, dur: 7000,
      cutin: { at: 4200, text: "追撃…", gold: false } },
  ],
  rushWin: [
    { w: 45, name: "RUSH速攻当り", reach: true, sp: 1, dur: 6500,
      cutin: { at: 3800, text: "追撃HIT!", gold: true } },
    { w: 40, name: "RUSH強当り",  reach: true, sp: 2, dur: 9000,
      yokoku: [{ at: 700, text: "激アツ!!", cls: "hot" }],
      cutin: { at: 5500, text: "金カットイン!!", gold: true } },
    { w: 10, name: "RUSH復活",    reach: true, sp: 1, dur: 8000, revival: true },
    { w: 5,  name: "RUSHプレミア", reach: true, sp: 2, dur: 7000, premium: true,
      yokoku: [{ at: 900, text: "★ PREMIUM ★", cls: "rainbow" }] },
  ],
};

/* ============ 5. Reels(図柄リール制御) ============ */
const Reels = (() => {
  const els = [0, 1, 2].map(i => document.getElementById("reel" + i));
  const timers = [null, null, null];

  function spin(i) {
    stop(i);
    els[i].classList.add("spinning");
    els[i].classList.remove("stopped", "win");
    timers[i] = setInterval(() => { els[i].textContent = pickInt(10); }, 60);
  }
  function stop(i, value) {
    if (timers[i]) { clearInterval(timers[i]); timers[i] = null; }
    els[i].classList.remove("spinning");
    if (value !== undefined) {
      els[i].textContent = value;
      els[i].classList.add("stopped");
    }
  }
  function spinAll() { [0, 1, 2].forEach(spin); }
  function stopAll() { [0, 1, 2].forEach(i => stop(i)); }
  function markWin() { els.forEach(e => e.classList.add("win")); }

  /** 停止図柄を決める(当り: ゾロ目 / リーチハズレ: ±1ズレ / 通常ハズレ: バラケ目) */
  function decideDigits({ win, reach, premium, rushHit }) {
    if (win) {
      if (premium) return [7, 7, 7];
      // 奇数=RUSH当り、偶数=通常当りの図柄法則
      const odds = [1, 3, 5, 7, 9], evens = [0, 2, 4, 6, 8];
      const n = rushHit ? odds[pickInt(5)] : evens[pickInt(5)];
      return [n, n, n];
    }
    if (reach) {
      const n = pickInt(10);
      return [n, n, (n + (chance(0.5) ? 1 : 9)) % 10]; // 中図柄だけ±1ズレ
    }
    const a = pickInt(10);
    let b = pickInt(10); if (b === a) b = (b + 1) % 10;
    return [a, b, pickInt(10)];
  }

  return { spin, stop, spinAll, stopAll, markWin, decideDigits };
})();

/* ============ 6. FX(汎用エフェクト) ============ */
const FX = (() => {
  const lcd = document.getElementById("lcd");
  const machine = document.getElementById("machine");
  const flash = document.getElementById("flash");
  const lamps = [document.getElementById("lampTop"), document.getElementById("lampBottom")];

  function doFlash(gold = false) {
    flash.classList.remove("go", "gold-flash");
    void flash.offsetWidth;                 // reflowでアニメ再生し直し
    if (gold) flash.classList.add("gold-flash");
    flash.classList.add("go");
  }
  function doShake() {
    machine.classList.remove("shake");
    void machine.offsetWidth;
    machine.classList.add("shake");
  }
  function setBg(cls) {                     // "", "bg-reach", "bg-sp1", "bg-sp2", "bg-rush"
    lcd.classList.remove("bg-reach", "bg-sp1", "bg-sp2", "bg-rush");
    if (cls) lcd.classList.add(cls);
  }
  function lampMode(mode) {                 // "calm" | "excited" | "gold"
    lamps.forEach(l => {
      l.classList.remove("excited", "gold");
      if (mode === "excited") l.classList.add("excited");
      if (mode === "gold") l.classList.add("gold");
    });
  }
  return { flash: doFlash, shake: doShake, setBg, lampMode };
})();

/* ============ 7. Director(変動演出の再生) ============
   パターン定義から setTimeout タイムラインを構築して再生。
   演出を数百種類に増やしても、この再生エンジンは共通。   */
const Director = (() => {
  let handles = [];
  const $ = (id) => document.getElementById(id);
  const yokokuEl = $("yokoku"), cutinEl = $("cutin"), reachEl = $("reachLabel");

  function at(ms, fn) { handles.push(setTimeout(fn, ms)); }
  function clearTimeline() {
    handles.forEach(clearTimeout); handles = [];
    yokokuEl.classList.add("hidden");
    cutinEl.classList.add("hidden");
    reachEl.classList.add("hidden");
  }

  function showYokoku(text, cls) {
    yokokuEl.textContent = text;
    yokokuEl.className = "yokoku " + (cls || "");
    handles.push(setTimeout(() => yokokuEl.classList.add("hidden"), 1600));
  }
  function showCutin(text, gold) {
    cutinEl.textContent = text;
    cutinEl.className = "cutin" + (gold ? " gold" : "");
    FX.flash(gold); FX.shake();
    handles.push(setTimeout(() => cutinEl.classList.add("hidden"), 1800));
  }

  /**
   * 変動を再生する
   * @param {object} p        パターン定義
   * @param {object} judge    {win, rushHit}
   * @param {string} holdColor 消化した保留の色
   * @param {function} onDone 変動終了コールバック(win を渡す)
   */
  function play(p, judge, holdColor, onDone) {
    clearTimeline();
    const digits = Reels.decideDigits({ ...judge, reach: p.reach, premium: p.premium });
    Reels.spinAll();

    // 先読み保留が赤以上ならランプ興奮
    if (holdColor === "red" || holdColor === "rainbow") FX.lampMode("excited");

    // --- 予告 ---
    (p.yokoku || []).forEach(y => at(y.at, () => showYokoku(y.text, y.cls)));
    if (holdColor === "rainbow") at(500, () => showYokoku("虹保留!!", "rainbow"));

    // --- リール停止タイミングを dur から逆算 ---
    const tLeft  = Math.min(1600, p.dur * 0.3);
    const tRight = Math.min(2800, p.dur * 0.45);
    const tCenter = p.dur - 400;

    at(tLeft,  () => Reels.stop(0, digits[0]));
    at(tRight, () => {
      // リーチ時: 右リールは左と同じ図柄で停止(テンパイ)
      Reels.stop(2, p.reach ? digits[0] : digits[2]);
      if (p.reach) {
        reachEl.classList.remove("hidden");
        FX.setBg("bg-reach");
        FX.lampMode("excited");
      }
    });

    // --- SP発展(背景変化) ---
    if (p.sp >= 1) at(tRight + 1500, () => { FX.setBg("bg-sp1"); FX.flash(); });
    if (p.sp >= 2) at(tRight + 4500, () => { FX.setBg("bg-sp2"); FX.flash(); FX.shake(); });

    // --- カットイン(チャンスアップ) ---
    if (p.cutin) at(p.cutin.at, () => showCutin(p.cutin.text, p.cutin.gold));

    // --- 中リール停止 → 結果 ---
    if (p.revival && judge.win) {
      // 一度ハズレ目で止めてから復活
      at(tCenter - 2200, () => {
        const miss = (digits[0] + 1) % 10;
        Reels.stop(1, miss);
      });
      at(tCenter - 600, () => {
        showYokoku("復活!!", "hot");
        FX.flash(true); FX.shake();
        Reels.stop(1, digits[0]);
        Reels.stop(0, digits[0]); Reels.stop(2, digits[0]);
      });
    } else {
      at(tCenter, () => {
        Reels.stop(1, judge.win ? digits[0] : digits[p.reach ? 2 : 1]);
        if (!judge.win && p.reach) FX.shake();  // 惜しい揺れ
      });
    }

    // --- 変動終了 ---
    at(p.dur, () => {
      reachEl.classList.add("hidden");
      if (judge.win) { Reels.markWin(); FX.flash(true); FX.lampMode("gold"); }
      else { FX.setBg(Game.isRush() ? "bg-rush" : ""); FX.lampMode(Game.isRush() ? "excited" : "calm"); }
      onDone(judge.win);
    });
  }

  return { play, clearTimeline };
})();

/* ============ 8. Game(状態管理・抽選・RUSH/ST) ============ */
const Game = (() => {
  const $ = (id) => document.getElementById(id);

  const state = {
    mode: "NORMAL",            // "NORMAL" | "RUSH"
    phase: "IDLE",             // "IDLE" | "SPIN" | "JACKPOT" | "BANNER"
    balls: CONFIG.launch.initialBalls,
    spins: 0,                  // 通常時の回転数(初当りまで)
    totalSpins: 0,
    launches: 0,
    hits: 0,
    stRemaining: 0,
    holds: [],                 // [{win, rushHit, color}]
    history: [],               // [{spin, label, rush}]
  };

  /* --- 抽選: 保留生成時に当落を先決め(先読みのため) ---
     注: モード跨ぎの残保留は生成時モードで判定する簡易仕様 */
  function judgeNewHold() {
    const p = state.mode === "RUSH" ? CONFIG.lottery.stProb : CONFIG.lottery.normalProb;
    const win = chance(p);
    const rushHit = win && (state.mode === "RUSH" || chance(CONFIG.lottery.rushEntry));
    const color = weightedPick(HOLD_COLOR_TABLE[win ? "win" : "lose"]).color;
    return { win, rushHit, color };
  }

  function addHold() {
    if (state.holds.length >= 4) return false;
    state.holds.push(judgeNewHold());
    renderHolds();
    return true;
  }

  /* --- メインループ: 保留があれば変動開始 --- */
  setInterval(() => {
    if (state.phase === "IDLE" && state.holds.length > 0) startVariation();
  }, 200);

  function startVariation() {
    state.phase = "SPIN";
    const hold = state.holds.shift();
    renderHolds();

    state.totalSpins++;
    if (state.mode === "NORMAL") state.spins++;
    else state.stRemaining--;
    renderStats();

    // パターン選択(モード×当落でテーブルを切替)
    const table = state.mode === "RUSH"
      ? (hold.win ? PATTERNS.rushWin : PATTERNS.rushLose)
      : (hold.win ? PATTERNS.normalWin : PATTERNS.normalLose);
    const pattern = weightedPick(table);

    Director.play(pattern, hold, hold.color, (win) => {
      if (win) jackpot(hold, pattern);
      else afterLose();
    });
  }

  function afterLose() {
    // ST消化終了チェック
    if (state.mode === "RUSH" && state.stRemaining <= 0) return endRush();
    state.phase = "IDLE";
  }

  /* --- 大当りシーケンス --- */
  function jackpot(hold, pattern) {
    state.phase = "JACKPOT";
    state.hits++;
    const rush = hold.rushHit;
    const rounds = rush ? CONFIG.payout.rushRounds : CONFIG.payout.normalRounds;

    state.history.unshift({
      spin: state.mode === "RUSH" ? "RUSH中" : state.spins + "回転",
      label: pattern.name + " " + rounds + "R",
      rush,
    });
    if (state.mode === "NORMAL") state.spins = 0;
    renderHistory();

    const overlay = $("jackpotOverlay"), jt = $("jackpotText"), rt = $("roundText");
    jt.textContent = pattern.premium ? "★PREMIUM 大当り★" : "大当り!!";
    jt.className = "jackpot-text" + (pattern.premium ? " premium" : "");
    rt.textContent = "";
    overlay.classList.remove("hidden");
    FX.flash(true); FX.shake(); FX.lampMode("gold");

    // ラウンド消化(テンポ良く出玉加算)
    let r = 0;
    const roundTimer = setInterval(() => {
      r++;
      rt.textContent = `ROUND ${r} / ${rounds}  +${CONFIG.payout.ballsPerRound}玉`;
      state.balls += CONFIG.payout.ballsPerRound;
      renderStats();
      FX.flash(true);
      if (r >= rounds) {
        clearInterval(roundTimer);
        setTimeout(() => finishJackpot(rush), CONFIG.timing.jackpotBanner);
        rt.textContent = rush ? "⚡ NEON RUSH 突入!! ⚡" : "通常時へ…";
      }
    }, CONFIG.timing.roundTick);
  }

  function finishJackpot(rush) {
    $("jackpotOverlay").classList.add("hidden");
    if (rush) {
      state.mode = "RUSH";
      state.stRemaining = CONFIG.lottery.stSpins;
      FX.setBg("bg-rush"); FX.lampMode("excited");
    } else {
      state.mode = "NORMAL";
      FX.setBg(""); FX.lampMode("calm");
    }
    renderMode(); renderStats();
    state.phase = "IDLE";
  }

  /* --- RUSH終了 --- */
  function endRush() {
    state.phase = "BANNER";
    const overlay = $("jackpotOverlay"), jt = $("jackpotText"), rt = $("roundText");
    jt.textContent = "RUSH終了…";
    jt.className = "jackpot-text";
    rt.textContent = "通常時に戻ります";
    overlay.classList.remove("hidden");
    setTimeout(() => {
      overlay.classList.add("hidden");
      state.mode = "NORMAL";
      FX.setBg(""); FX.lampMode("calm");
      renderMode(); renderStats();
      state.phase = "IDLE";
    }, CONFIG.timing.rushEndBanner);
  }

  /* --- 玉の発射 --- */
  function launchBall() {
    if (state.balls <= 0) return;
    state.balls--;
    state.launches++;
    if (chance(CONFIG.launch.startRate)) {
      state.balls += CONFIG.payout.startPay;
      addHold();
    }
    renderStats();
  }

  /* --- 描画 --- */
  function renderStats() {
    $("ballCount").textContent = state.balls;
    $("spinCount").textContent = state.totalSpins;
    $("hitCount").textContent = state.hits;
    $("launchCount").textContent = state.launches;
    const mt = $("modeText");
    mt.textContent = state.mode === "RUSH" ? "RUSH" : "通常";
    mt.classList.toggle("rush", state.mode === "RUSH");
    const st = $("stInfo");
    if (state.mode === "RUSH") {
      st.textContent = `ST残り ${state.stRemaining} 回転`;
      st.classList.remove("hidden");
    } else st.classList.add("hidden");
  }
  function renderMode() {
    $("modeBanner").classList.toggle("hidden", state.mode !== "RUSH");
  }
  function renderHolds() {
    for (let i = 0; i < 4; i++) {
      const el = $("hold" + i), h = state.holds[i];
      el.className = "hold-orb " + (h ? "c-" + h.color : "empty");
    }
  }
  function renderHistory() {
    const ul = $("history");
    ul.innerHTML = state.history.slice(0, 12).map(h =>
      `<li class="${h.rush ? "rush" : ""}">${h.spin} ─ ${h.label}${h.rush ? " ⚡RUSH" : ""}</li>`
    ).join("") || '<li class="history-empty">まだ大当りはありません</li>';
  }

  /* --- 画像差し替え適用 --- */
  function applyAssets() {
    if (ASSETS.lcdBg) $("lcdBg").style.backgroundImage = `url(${ASSETS.lcdBg})`;
    if (ASSETS.character) {
      const c = $("character");
      c.textContent = "";
      c.style.backgroundImage = `url(${ASSETS.character})`;
      c.style.width = "160px"; c.style.height = "200px";
    }
  }

  applyAssets(); renderStats(); renderHolds();
  return { launchBall, isRush: () => state.mode === "RUSH", state };
})();

/* ============ 9. Input(発射・自動プレイ) ============ */
(() => {
  const fireBtn = document.getElementById("fireBtn");
  const autoChk = document.getElementById("autoChk");
  let firing = false, timer = null;

  function updateLoop() {
    const active = firing || autoChk.checked;
    fireBtn.classList.toggle("firing", active);
    if (active && !timer) {
      timer = setInterval(() => {
        if (firing || autoChk.checked) Game.launchBall();
        else { clearInterval(timer); timer = null; fireBtn.classList.remove("firing"); }
      }, CONFIG.launch.interval);
    }
  }

  const start = (e) => { e.preventDefault(); firing = true; updateLoop(); };
  const stop = () => { firing = false; };

  fireBtn.addEventListener("mousedown", start);
  fireBtn.addEventListener("touchstart", start, { passive: false });
  window.addEventListener("mouseup", stop);
  window.addEventListener("touchend", stop);

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !e.repeat) { e.preventDefault(); firing = true; updateLoop(); }
  });
  window.addEventListener("keyup", (e) => { if (e.code === "Space") firing = false; });

  autoChk.addEventListener("change", updateLoop);

  document.getElementById("addBalls").addEventListener("click", () => {
    Game.state.balls += 500;
    document.getElementById("ballCount").textContent = Game.state.balls;
  });
})();
