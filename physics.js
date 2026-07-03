/* ============================================================
   physics.js - 甘雨パチンコ 物理盤面エンジン
   ライブラリ不要。台画像の上に透明Canvasを重ね、
   玉の発射→レール→釘・風車→スタート入賞/アウト回収 を物理演算する。

   構成:
     PACHI_LAYOUT … 盤面レイアウト(釘座標など)。画像に合わせてここを調整
     Physics      … エンジン本体。script.js から init() と launch() を呼ぶ

   座標系: 論理幅1000固定。高さは表示エリアの縦横比から自動決定。
   (今の甘雨の台画像だと高さ約1780相当)

   デバッグモード: URLの末尾に ?debug=1 を付けて開くと
   釘・入賞口・回収口が半透明表示され、画面タップで論理座標が出る。
   釘の位置合わせに使ってください。
   ============================================================ */

"use strict";

/* ============ 盤面レイアウト(画像に合わせて調整する場所) ============ */
const PACHI_LAYOUT = {
  /* 盤面の円: 台画像の丸いガラス面に合わせる */
  board: { cx: 500, cy: 700, r: 400 },

  /* 玉が下に抜けるアウト開口(盤面円の最下部±この角度は壁なし) */
  outGap: 0.26,               // ラジアン

  /* スタートチャッカー(ヘソ) */
  start: { x: 500, y: 1015, w: 34 },

  /* 風車: dir=1で時計回り */
  windmills: [
    { x: 300, y: 800, r: 16, dir: 1 },
    { x: 700, y: 800, r: 16, dir: -1 },
  ],

  /* 釘 [x, y] の配列 */
  pins: [
    // 天釘(上部で玉を散らす)
    [460, 420], [540, 420], [500, 470],
    // 寄り釘(上段スキャッタ)
    [380, 460], [620, 460],
    [340, 520], [420, 520], [580, 520], [660, 520],
    [300, 580], [380, 580], [460, 580], [540, 580], [620, 580], [700, 580],
    // サイドガイド(左)
    [215, 700], [230, 760], [250, 820], [275, 880], [305, 935],
    // サイドガイド(右)
    [785, 700], [770, 760], [750, 820], [725, 880], [695, 935],
    // 道釘(下段・玉をヘソ方向へ誘導)
    [340, 1000], [375, 1000], [410, 1000], [445, 1000],
    [660, 1000], [625, 1000], [590, 1000], [555, 1000],
    // 命釘(ヘソ直上の2本。間隔で入賞率が変わる)
    [478, 985], [522, 985],
  ],
};

/* ============ 物理エンジン本体 ============ */
const Physics = (() => {
  /* --- 調整用の物理定数 --- */
  const CONST = {
    ballR: 10,          // 玉の半径(論理px)
    pinR: 4,            // 釘の半径
    gravity: 1500,      // 重力(論理px/s^2)
    restPin: 0.55,      // 釘の反発係数
    restWall: 0.45,     // 壁の反発係数
    restBall: 0.4,      // 玉同士の反発係数
    tangentDamp: 0.85,  // 衝突時の接線方向の減速
    windmillSpin: 130,  // 風車が玉に与える接線速度
    railSpeedMin: 480,  // 発射強度0のレール速度
    railSpeedMax: 1250, // 発射強度100のレール速度
    maxBalls: 45,       // 同時最大玉数
    stuckTime: 2.5,     // この秒数ほぼ動かない玉は回収
  };

  const L = PACHI_LAYOUT;
  const LOGICAL_W = 1000;

  let canvas, ctx, lcd, scale = 1, logicalH = 1780;
  let balls = [];            // {x,y,vx,vy, phase:"rail"|"free", ang, spd, still}
  let onStartIn = () => {};
  let debug = /debug=1/.test(location.search);
  let debugTapInfo = null;

  /* ---------- 初期化 ---------- */
  function init(opts = {}) {
    if (opts.onStartIn) onStartIn = opts.onStartIn;
    lcd = document.getElementById("lcd");

    canvas = document.createElement("canvas");
    canvas.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;z-index:4;pointer-events:" +
      (debug ? "auto" : "none");
    lcd.appendChild(canvas);
    ctx = canvas.getContext("2d");

    new ResizeObserver(resize).observe(lcd);
    resize();

    /* 発射強度スライダーのラベル連動(あれば) */
    const sl = document.getElementById("strength"), sv = document.getElementById("strengthVal");
    if (sl && sv) sl.addEventListener("input", () => (sv.textContent = sl.value + "%"));

    /* デバッグ: タップで論理座標を表示 */
    if (debug) {
      canvas.addEventListener("pointerdown", (e) => {
        const rc = canvas.getBoundingClientRect();
        const x = Math.round((e.clientX - rc.left) / rc.width * LOGICAL_W);
        const y = Math.round((e.clientY - rc.top) / rc.height * logicalH);
        debugTapInfo = { x, y, t: performance.now() };
        console.log(`[${x}, ${y}],`);
      });
    }

    requestAnimationFrame(loop);
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = lcd.clientWidth, h = lcd.clientHeight;
    if (!w || !h) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    scale = canvas.width / LOGICAL_W;
    logicalH = canvas.height / scale;
  }

  /* ---------- 発射 ----------
     strength: 0〜1。レール(盤面円の内周)を 下→左→上 と進み、
     強度に応じた角度で盤面に放たれる。弱すぎるとファウル。 */
  function launch(strength = 0.62) {
    if (balls.length >= CONST.maxBalls) balls.shift();
    const s = Math.max(0, Math.min(1, strength));
    balls.push({
      phase: "rail",
      ang: Math.PI / 2,                 // 盤面円の最下部からスタート
      spd: CONST.railSpeedMin + s * (CONST.railSpeedMax - CONST.railSpeedMin),
      release: Math.PI * 0.95 + s * Math.PI * 0.72,  // 離脱角(強いほど上まで回る)
      x: 0, y: 0, vx: 0, vy: 0, still: 0,
    });
  }

  /* ---------- メインループ(固定タイムステップ) ---------- */
  let last = 0, acc = 0;
  const DT = 1 / 120;
  function loop(t) {
    requestAnimationFrame(loop);
    if (!last) last = t;
    acc += Math.min((t - last) / 1000, 0.1);
    last = t;
    while (acc > DT) { step(DT); acc -= DT; }
    draw();
  }

  /* ---------- 1ステップ ---------- */
  function step(dt) {
    const B = L.board, rIn = B.r - CONST.ballR - 2;

    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];

      /* === レール上: 円周に沿って移動 === */
      if (b.phase === "rail") {
        b.ang += (b.spd / rIn) * dt;          // 角度を進める(下→左→上)
        b.x = B.cx + rIn * Math.cos(b.ang);
        b.y = B.cy + rIn * Math.sin(b.ang);
        b.spd -= 260 * dt;                    // レール摩擦で減速
        /* 離脱角に到達 or 失速でリリース(失速=ファウル軌道) */
        if (b.ang >= b.release || b.spd < 120) {
          b.phase = "free";
          b.vx = -Math.sin(b.ang) * b.spd;    // 接線方向の速度に変換
          b.vy = Math.cos(b.ang) * b.spd;
        }
        continue;
      }

      /* === 自由落下: サブ分割してすり抜け防止 === */
      b.vy += CONST.gravity * dt;
      const speed = Math.hypot(b.vx, b.vy);
      const sub = Math.max(1, Math.ceil(speed * dt / (CONST.ballR * 0.8)));
      for (let k = 0; k < sub; k++) {
        b.x += b.vx * dt / sub;
        b.y += b.vy * dt / sub;
        collide(b);
      }

      /* === スタート入賞判定 === */
      if (Math.abs(b.x - L.start.x) < L.start.w / 2 &&
          b.y > L.start.y && b.y < L.start.y + 30 && b.vy > 0) {
        balls.splice(i, 1);
        onStartIn();
        continue;
      }

      /* === アウト回収(盤面の下に抜けた玉) === */
      if (b.y > B.cy + B.r + 60) { balls.splice(i, 1); continue; }

      /* === 詰まり回収 === */
      b.still = Math.hypot(b.vx, b.vy) < 10 ? b.still + dt : 0;
      if (b.still > CONST.stuckTime) balls.splice(i, 1);
    }
  }

  /* ---------- 衝突処理 ---------- */
  function collide(b) {
    const B = L.board;

    /* 外周の円(内側から衝突)。最下部±outGapは開口=アウトへ抜ける */
    const dx = b.x - B.cx, dy = b.y - B.cy;
    const d = Math.hypot(dx, dy), lim = B.r - CONST.ballR;
    if (d > lim) {
      const ang = Math.atan2(dy, dx);
      const gap = Math.abs(ang - Math.PI / 2) < L.outGap;   // 下の開口
      if (!gap) {
        const nx = dx / d, ny = dy / d;
        b.x = B.cx + nx * lim; b.y = B.cy + ny * lim;
        const vn = b.vx * nx + b.vy * ny;
        if (vn > 0) reflect(b, nx, ny, vn, CONST.restWall);
      }
    }

    /* 釘 */
    for (const [px, py] of L.pins) hitCircle(b, px, py, CONST.pinR, CONST.restPin, 0);

    /* 風車(当たると回転方向に弾かれる) */
    for (const w of L.windmills) hitCircle(b, w.x, w.y, w.r, CONST.restPin, w.dir * CONST.windmillSpin);

    /* 玉同士 */
    for (const o of balls) {
      if (o === b || o.phase === "rail") continue;
      const ddx = b.x - o.x, ddy = b.y - o.y;
      const dd = Math.hypot(ddx, ddy), min = CONST.ballR * 2;
      if (dd > 0 && dd < min) {
        const nx = ddx / dd, ny = ddy / dd, push = (min - dd) / 2;
        b.x += nx * push; b.y += ny * push;
        o.x -= nx * push; o.y -= ny * push;
        const rvx = b.vx - o.vx, rvy = b.vy - o.vy;
        const vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          const imp = -(1 + CONST.restBall) * vn / 2;
          b.vx += nx * imp; b.vy += ny * imp;
          o.vx -= nx * imp; o.vy -= ny * imp;
        }
      }
    }
  }

  /* 円形障害物との衝突(spin≠0なら風車として接線速度を付加) */
  function hitCircle(b, cx, cy, cr, rest, spin) {
    const dx = b.x - cx, dy = b.y - cy;
    const d = Math.hypot(dx, dy), min = cr + CONST.ballR;
    if (d > 0 && d < min) {
      const nx = dx / d, ny = dy / d;
      b.x = cx + nx * min; b.y = cy + ny * min;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) reflect(b, -nx, -ny, -vn, rest);
      if (spin) { b.vx += -ny * spin; b.vy += nx * spin; }
    }
  }

  /* 法線方向に反射し、接線方向を減速 */
  function reflect(b, nx, ny, vn, rest) {
    const tx = b.vx - vn * nx, ty = b.vy - vn * ny;   // 接線成分
    b.vx = tx * CONST.tangentDamp - vn * nx * rest;
    b.vy = ty * CONST.tangentDamp - vn * ny * rest;
  }

  /* ---------- 描画 ---------- */
  function draw() {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, LOGICAL_W, logicalH);

    /* 玉(銀色) */
    for (const b of balls) {
      const g = ctx.createRadialGradient(b.x - 3, b.y - 3, 1, b.x, b.y, CONST.ballR);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.6, "#c9d4e0");
      g.addColorStop(1, "#6a7684");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, CONST.ballR, 0, Math.PI * 2);
      ctx.fill();
    }

    if (debug) drawDebug();
  }

  function drawDebug() {
    const B = L.board;
    /* 盤面円とアウト開口 */
    ctx.strokeStyle = "rgba(0,255,255,.5)"; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(B.cx, B.cy, B.r, Math.PI / 2 + L.outGap, Math.PI / 2 - L.outGap);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,60,60,.8)";
    ctx.beginPath();
    ctx.arc(B.cx, B.cy, B.r, Math.PI / 2 - L.outGap, Math.PI / 2 + L.outGap);
    ctx.stroke();
    /* 釘 */
    ctx.fillStyle = "rgba(255,220,60,.9)";
    for (const [px, py] of L.pins) {
      ctx.beginPath(); ctx.arc(px, py, CONST.pinR + 2, 0, Math.PI * 2); ctx.fill();
    }
    /* 風車 */
    ctx.strokeStyle = "rgba(120,200,255,.9)";
    for (const w of L.windmills) {
      ctx.beginPath(); ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2); ctx.stroke();
    }
    /* スタートチャッカー */
    ctx.fillStyle = "rgba(60,255,120,.6)";
    ctx.fillRect(L.start.x - L.start.w / 2, L.start.y, L.start.w, 30);
    /* タップ座標 */
    if (debugTapInfo && performance.now() - debugTapInfo.t < 3000) {
      ctx.fillStyle = "#fff"; ctx.font = "28px sans-serif";
      ctx.fillText(`[${debugTapInfo.x}, ${debugTapInfo.y}]`, 30, 60);
      ctx.beginPath(); ctx.arc(debugTapInfo.x, debugTapInfo.y, 6, 0, Math.PI * 2); ctx.fill();
    }
  }

  return { init, launch };
})();
