/* ============================================================
   BYME · Be Yourself — 滚动与视频播放控制
   1. 首屏 intro.mp4 播一次 → 交叉溶解显示 cover.png
   2. 滚动到哪个区块，就只播放哪个区块的视频（其余全部暂停）
   3. 顶部进度条 + 右侧区块导航
   ============================================================ */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var screens  = Array.prototype.slice.call(document.querySelectorAll(".screen"));
  var introSec = document.getElementById("screen-intro");
  var introVid = document.getElementById("introVideo");
  var skipBtn  = document.getElementById("introSkip");
  var bar      = document.getElementById("progressBar");
  var dots     = Array.prototype.slice.call(document.querySelectorAll(".rail__dot"));

  function videosOf(sec) {
    return Array.prototype.slice.call(sec.querySelectorAll("video"));
  }
  function safePlay(v) {
    if (!v || reduceMotion) return;
    var p = v.play();
    if (p && typeof p.catch === "function") p.catch(function () { /* 被浏览器拦截则静默 */ });
  }
  function safePause(v) {
    if (!v) return;
    try { v.pause(); } catch (e) {}
  }

  /* 刷新后始终从首屏开场开始 */
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  window.scrollTo(0, 0);

  /* ============================================================
     1. 首屏：intro.mp4 播完 → 显示 cover.png（画面完全静止）
     ============================================================ */
  var introDone = false;

  function finishIntro() {
    if (introDone) return;
    introDone = true;
    introSec.classList.add("is-cover");   // 视频淡出，露出静态封面 + 四个按钮
    safePause(introVid);
  }

  if (introVid) {
    introVid.addEventListener("ended", finishIntro);
    introVid.addEventListener("error", finishIntro);

    if (reduceMotion) {
      finishIntro();                      // 关掉动效 → 直接看静态封面
    } else {
      safePlay(introVid);

      // 兜底 1：4.5s 还没加载起来（网络慢），直接进封面，不干等
      setTimeout(function () {
        if (!introDone && introVid.readyState < 3) finishIntro();
      }, 4500);

      // 兜底 2：开始播放后却没播完（自动播放被拦 / 解码卡住），
      //         按「时长 + 1.2s」收尾，绝不把用户锁在首屏
      setTimeout(function () {
        if (introDone) return;
        if (introVid.paused && introVid.currentTime < 0.2) { finishIntro(); return; }
        var d = introVid.duration;
        var wait = (isFinite(d) && d > 0 ? d * 1000 : 6000) + 1200;
        setTimeout(function () { if (!introDone) finishIntro(); }, wait);
      }, 1500);
    }
  }

  // 用户主动滚动或按方向键 → 立刻结束开场（不锁滚动，尊重用户意图）
  ["wheel", "touchmove", "keydown"].forEach(function (type) {
    window.addEventListener(type, function (e) {
      if (introDone) return;
      if (type === "keydown") {
        var keys = ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "];
        if (keys.indexOf(e.key) === -1) return;
      }
      finishIntro();
    }, { passive: true });
  });

  if (skipBtn) skipBtn.addEventListener("click", finishIntro);

  /* ============================================================
     2. 区块激活：只播放当前区块的视频，暂停其他所有区块
     ============================================================ */
  var active = null;
  var hasIO = "IntersectionObserver" in window;

  function activate(sec) {
    if (!sec || sec === active) return;
    active = sec;

    screens.forEach(function (s) { s.classList.toggle("is-active", s === sec); });

    screens.forEach(function (s) {
      var on = (s === sec);
      videosOf(s).forEach(function (v) {
        if (v === introVid) return;       // 首屏视频由 finishIntro 单独管理
        if (on) safePlay(v); else safePause(v);
      });
    });

    // 亮屏（技能特长）→ 右侧导航反色
    document.body.classList.toggle("is-light", sec.classList.contains("is-light-screen"));

    // 右侧导航高亮
    dots.forEach(function (d) {
      d.classList.toggle("is-active", d.getAttribute("data-target") === sec.id);
    });
  }

  // 兜底：谁离视口中线最近就激活谁。
  // 不依赖 IntersectionObserver（个别环境 / 无头渲染下它不回调），
  // 双保险保证「滚到哪屏就播哪屏」永远成立。
  function activateByScroll() {
    var mid = window.scrollY + window.innerHeight / 2;
    var best = null, bestDist = Infinity;
    screens.forEach(function (s) {
      var d = Math.abs(s.offsetTop + s.offsetHeight / 2 - mid);
      if (d < bestDist) { bestDist = d; best = s; }
    });
    activate(best);
  }

  if (hasIO) {
    var io = new IntersectionObserver(function (entries) {
      var best = null, bestRatio = 0;
      entries.forEach(function (en) {
        if (en.isIntersecting && en.intersectionRatio > bestRatio) {
          bestRatio = en.intersectionRatio;
          best = en.target;
        }
      });
      if (best && bestRatio >= 0.55) activate(best);
    }, { threshold: [0, 0.25, 0.55, 0.75, 1] });
    screens.forEach(function (s) { io.observe(s); });
  }

  /* ============================================================
     3. 顶部滚动进度条
     ============================================================ */
  var ticking = false;
  function onScroll() {
    // 切屏判断同步执行（不排进 rAF）—— 保证任何环境下滚动都能切换视频
    activateByScroll();

    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight;
      var y = window.scrollY || doc.scrollTop || 0;
      if (bar) bar.style.width = (max > 0 ? (y / max) * 100 : 0).toFixed(2) + "%";
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);

  /* ============================================================
     4. 右侧区块导航点击跳转
     ============================================================ */
  dots.forEach(function (d) {
    d.addEventListener("click", function () {
      var target = document.getElementById(d.getAttribute("data-target"));
      if (!target) return;
      finishIntro();
      target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    });
  });

  /* ============================================================
     5. 切到别的标签页时全部暂停，回来再播当前屏（省电省 CPU）
     ============================================================ */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      screens.forEach(function (s) {
        videosOf(s).forEach(function (v) { if (v !== introVid) safePause(v); });
      });
    } else if (active && !reduceMotion && !active.classList.contains("screen--intro")) {
      videosOf(active).forEach(safePlay);
    }
  });

  /* ============================================================
     6. 热区校准：按 D 键显示四个按钮热区的边框（方便微调百分比）
     ============================================================ */
  window.addEventListener("keydown", function (e) {
    if ((e.key === "d" || e.key === "D") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      document.body.classList.toggle("calib");
    }
  });

  /* 首屏默认激活 */
  activate(introSec);
  onScroll();
})();
