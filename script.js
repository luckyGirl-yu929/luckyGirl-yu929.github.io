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
  var projectScreen = document.getElementById("screen-03");
  projectScreen.classList.add("projects-ready");

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
    if (sec === projectScreen) projectScreen.classList.add("projects-entered");

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

  // 03 项目档案：原生 dialog 提供 top layer 与背景 inert，焦点返回触发卡片。
  var projectFiles = {
    agent: {
      index: "01 / AI AGENT · PROJECT FILE", title: "LabOps Agent", subtitle: "智能实验室预约 Agent",
      origin: "从电子工程师实际经历的实验室资源预约问题出发，探索用自然语言和业务规则简化设备预约流程。",
      capabilities: ["自然语言描述测试需求", "自动推荐匹配设备", "检查时间冲突、配套关系与使用限制", "生成预约确认单并追踪预约状态"],
      href: "/projects/LabOps_Agent.html"
    },
    skill: {
      index: "02 / AI SKILL · PROJECT FILE", title: "Knowledge Skill", subtitle: "工程经验知识沉淀",
      origin: "围绕工程实践中的测试经验与问题排查方法，探索把分散的个人经验整理为可查询、可追溯的知识。",
      capabilities: ["整理工程经验与测试方法", "按问题和场景查询参考方法", "关联原始记录，保留知识来源"],
      note: "以上为项目探索方向"
    },
    video: {
      index: "03 / AI EVALUATION · PROJECT FILE", title: "AI Video Lab", subtitle: "AI 视频模型测评",
      origin: "从 AI 视频生成的实际观看体验出发，探索用一致的观察维度比较不同模型，记录能力与局限。",
      capabilities: ["对比多模型的视频生成效果", "观察角色外观与跨镜头一致性", "评测动作表现、连贯性与自然程度"],
      note: "以上为项目探索方向"
    }
  };
  var projectDialog = document.getElementById("project-file");
  var projectClose = projectDialog.querySelector(".project-file__close");
  var projectOpener = null;
  var projectCloseTimer;
  var backdropPress = false;
  function closeProjectFile() {
    if (!projectDialog.open || projectDialog.classList.contains("is-closing")) return;
    projectDialog.classList.add("is-closing");
    var delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 250;
    projectCloseTimer = setTimeout(function () { projectDialog.close(); }, delay);
  }
  document.querySelectorAll("#screen-03 button.project-sticker").forEach(function (card) {
    card.addEventListener("click", function () {
      var data = projectFiles[card.dataset.project];
      if (!data || projectDialog.open) return;
      projectOpener = card;
      document.getElementById("project-file-index").textContent = data.index;
      document.getElementById("project-file-title").textContent = data.title;
      document.getElementById("project-file-subtitle").textContent = data.subtitle;
      document.getElementById("project-file-origin").textContent = data.origin;
      var list = document.getElementById("project-file-capabilities");
      list.replaceChildren();
      data.capabilities.forEach(function (text) {
        var item = document.createElement("li"); item.textContent = text; list.appendChild(item);
      });
      var link = projectDialog.querySelector(".project-file__link");
      link.hidden = !data.href;
      if (data.href) link.setAttribute("href", data.href); else link.removeAttribute("href");
      projectDialog.querySelector(".project-file__pending").hidden = !!data.href;
      projectDialog.querySelector(".project-file__note").textContent = data.note || "BYME · PROJECT ARCHIVE";
      projectDialog.classList.remove("is-closing");
      document.documentElement.classList.add("project-modal-open");
      projectDialog.showModal();
      projectDialog.scrollTop = 0;
      projectClose.focus({ preventScroll: true });
    });
  });
  projectClose.addEventListener("click", closeProjectFile);
  projectDialog.addEventListener("cancel", function (event) { event.preventDefault(); closeProjectFile(); });
  projectDialog.addEventListener("close", function () {
    clearTimeout(projectCloseTimer);
    projectDialog.classList.remove("is-closing");
    document.documentElement.classList.remove("project-modal-open");
    if (projectOpener) projectOpener.focus({ preventScroll: true });
  });
  function outsideProjectFile(event) {
    var rect = projectDialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  }
  projectDialog.addEventListener("pointerdown", function (event) { backdropPress = outsideProjectFile(event); });
  projectDialog.addEventListener("click", function (event) {
    if (event.target === projectDialog && backdropPress && outsideProjectFile(event)) closeProjectFile();
    backdropPress = false;
  });
  projectDialog.addEventListener("keydown", function (event) {
    if (event.key !== "Tab") return;
    var focusable = Array.prototype.slice.call(projectDialog.querySelectorAll("button, a[href]"))
      .filter(function (element) { return !element.hidden && element.getClientRects().length; });
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  /* 首屏默认激活 */
  activate(introSec);
  onScroll();
})();

/* ============================================================
   7. 01 屏 · BYME 人物故事册
   桌面贴纸卡 / 移动端章节入口 → 故事册弹窗：
   上一章 / 下一章 / ← → 方向键 / Esc / 点遮罩 / ✕ 关闭，
   打开时锁背景滚动并做简单焦点圈定。
   ============================================================ */
(function () {
  "use strict";

  var modal = document.getElementById("storyModal");
  if (!modal) return;

  var panel    = modal.querySelector(".story-modal__panel");
  var pages    = Array.prototype.slice.call(modal.querySelectorAll(".story-page"));
  var eyebrow  = document.getElementById("storyEyebrow");
  var titleEl  = document.getElementById("storyTitle");
  var curEl    = document.getElementById("storyCur");
  var prevBtn  = document.getElementById("storyPrev");
  var nextBtn  = document.getElementById("storyNext");
  var closeBtn = modal.querySelector(".story-modal__close");
  var htmlEl   = document.documentElement;
  var cur = 0, lastFocus = null, closeTimer = null;

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function show(i, dir) {
    cur = Math.max(0, Math.min(pages.length - 1, i));
    pages.forEach(function (p, idx) {
      p.classList.remove("flip-next", "flip-prev");
      p.classList.toggle("is-current", idx === cur);
      if (idx === cur && dir) p.classList.add(dir > 0 ? "flip-next" : "flip-prev");
    });
    eyebrow.textContent = pages[cur].getAttribute("data-eyebrow") || "";
    titleEl.textContent = pages[cur].getAttribute("data-title") || "";
    curEl.textContent = pad(cur + 1);
    prevBtn.disabled = cur === 0;
    nextBtn.disabled = cur === pages.length - 1;
    panel.scrollTop = 0;
  }

  function open(i) {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    lastFocus = document.activeElement;
    modal.classList.remove("is-closing");
    modal.hidden = false;
    modal.classList.add("is-open");
    htmlEl.classList.add("story-lock");
    show(i || 0, 0);
    closeBtn.focus();
  }

  function close() {
    modal.classList.add("is-closing");
    modal.classList.remove("is-open");
    htmlEl.classList.remove("story-lock");
    closeTimer = setTimeout(function () {
      modal.hidden = true;
      modal.classList.remove("is-closing");
      closeTimer = null;
    }, 260);
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  /* 触发器：桌面贴纸卡 + 移动端章节入口 */
  document.querySelectorAll("[data-chapter]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      open(parseInt(btn.getAttribute("data-chapter"), 10) || 0);
    });
  });

  prevBtn.addEventListener("click", function () { show(cur - 1, -1); });
  nextBtn.addEventListener("click", function () { show(cur + 1, 1); });
  modal.querySelectorAll("[data-close]").forEach(function (el) {
    el.addEventListener("click", close);
  });

  document.addEventListener("keydown", function (e) {
    if (!modal.classList.contains("is-open")) return;
    if (e.key === "Escape") { close(); }
    else if (e.key === "ArrowRight") { show(cur + 1, 1); }
    else if (e.key === "ArrowLeft") { show(cur - 1, -1); }
    else if (e.key === "Tab") {
      /* 焦点圈定在弹窗内 */
      var f = panel.querySelectorAll("button:not([disabled])");
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    }
  });
})();
