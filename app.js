/* 收纳箱管理 — 纯静态版（无服务器） v20260922
 * - 数据：同目录 boxes.json（同源，微信可直接读）
 * - 保存：填了 GitHub Token 就自动提交到仓库；没填就下载 boxes.json 让你手动上传
 * - 照片：自动压缩后内嵌进 boxes.json（base64），微信扫码直接显示
 */
(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }

  var boxes = [];
  var editing = null;       // 当前编辑中的箱子（深拷贝）
  var editIsNew = true;
  var editOrigId = "";      // 编辑前的原始编号（用于重名校验与改编号时定位旧记录）
  var pendingPhotos = [];   // 本次新增的照片（base64）
  var saving = false;       // 防连点：一次提交没走完前不接受第二次

  /* ---------------- 存储 ---------------- */
  function getGh() {
    try { return JSON.parse(localStorage.getItem("sqr_gh") || "{}"); }
    catch (e) { return {}; }
  }
  function setGh(o) { localStorage.setItem("sqr_gh", JSON.stringify(o)); }

  function loadBoxes() {
    fetch("./boxes.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) return [];
        return r.json();
      })
      .then(function (list) {
        if (Array.isArray(list)) { boxes = list; renderList(); }
        else { boxes = []; renderList(); }
      })
      .catch(function () { boxes = []; renderList(); });
  }

  function saveBoxes() {
    var cfg = getGh();
    if (cfg.repo && cfg.token) ghCommit(cfg);
    else downloadBoxes();
  }

  function downloadBoxes() {
    var blob = new Blob([JSON.stringify(boxes, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "boxes.json";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    toast("已下载 boxes.json —— 请拖到 GitHub 仓库替换原文件并 Commit");
  }

  // 通过 GitHub API 提交 boxes.json（更新或新建）
  function ghCommit(cfg) {
    var branch = cfg.branch || "main";
    var url = "https://api.github.com/repos/" + cfg.repo + "/contents/boxes.json";
    var content = btoa(unescape(encodeURIComponent(JSON.stringify(boxes, null, 2))));
    var run = function (sha) {
      var body = { message: "update boxes", content: content, branch: branch };
      if (sha) body.sha = sha;
      fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.token },
        body: JSON.stringify(body)
      }).then(function (r) {
        if (r.ok) { toast("已同步到 GitHub ✅"); setSyncStatus("上次同步：" + new Date().toLocaleString()); }
        else {
          var fail = function (msg) { toast("同步失败：" + msg + " —— 数据还没传到线上，请再点一次「保存」（先别刷新）", 6000); };
          r.json().then(function (j) { fail(j.message || r.status); }).catch(function () { fail(r.status); });
        }
      }).catch(function (e) { toast("同步失败：" + (e.message || e) + " —— 数据还没传到线上，请再点一次「保存」（先别刷新）", 6000); });
    };
    // 先取 sha（已存在则更新，否则新建）
    fetch(url + "?ref=" + encodeURIComponent(branch), { headers: { Authorization: "Bearer " + cfg.token } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { run(j ? j.sha : null); })
      .catch(function () { run(null); });
  }

  function setSyncStatus(t) { var s = $("sync-status"); if (s) s.textContent = t; }

  /* ---------------- 列表渲染 ---------------- */
  function renderList() {
    var wrap = $("box-list");
    if (!boxes.length) { wrap.innerHTML = '<p class="hint">还没有箱子，点右上角「＋ 新建箱子」。</p>'; return; }
    wrap.innerHTML = boxes.map(function (b) {
      var cnt = (b.items || []).length;
      var pc = (b.photos || []).length;
      return ''
        + '<div class="box-card" data-id="' + esc(b.id) + '">'
        + '  <div class="bc-main">'
        + '    <div class="bc-id">' + esc(b.id) + (b.name ? ' · ' + esc(b.name) : '') + '</div>'
        + '    <div class="bc-sub">' + (b.location ? esc(b.location) + ' · ' : '') + (cnt ? cnt + ' 件物品 · ' : '') + (pc ? pc + ' 张照片' : '') + '</div>'
        + '  </div>'
        + '  <div class="bc-actions">'
        + '    <button class="btn ghost sm" data-act="qr">二维码</button>'
        + '    <button class="btn ghost sm" data-act="edit">编辑</button>'
        + '    <button class="btn danger ghost sm" data-act="del">删除</button>'
        + '  </div>'
        + '</div>';
    }).join("");
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* ---------------- 编辑 ---------------- */
  function openEdit(id) {
    editIsNew = !id;
    editOrigId = id ? String(id).trim() : "";
    pendingPhotos = [];
    if (editIsNew) {
      editing = { id: "", name: "", location: "", note: "", items: [], photos: [] };
    } else {
      var src = boxes.filter(function (b) { return b.id === id; })[0];
      if (!src) return;
      editing = JSON.parse(JSON.stringify(src));
    }
    $("edit-title").textContent = editIsNew ? "新建箱子" : "编辑箱子 " + editing.id;
    $("f-id").value = editing.id || "";
    $("f-name").value = editing.name || "";
    $("f-loc").value = editing.location || "";
    $("f-note").value = editing.note || "";
    renderItems();
    renderPhotoPrevs();
    $("btn-del").style.display = editIsNew ? "none" : "";
    $("edit-modal").classList.remove("hidden");
  }

  function renderItems() {
    var rows = (editing.items || []).map(function (it, i) {
      return itemRowHtml(i, it.name || "", it.qty || "", it.note || "");
    }).join("");
    $("item-rows").innerHTML = rows || itemRowHtml(0, "", "", "");
  }
  function itemRowHtml(i, name, qty, note) {
    return '<div class="item-row" data-i="' + i + '">'
      + '<input class="ir-name" placeholder="物品名" value="' + esc(name) + '">'
      + '<input class="ir-qty" placeholder="数量" value="' + esc(qty) + '">'
      + '<input class="ir-note" placeholder="备注" value="' + esc(note) + '">'
      + '<button class="ir-x" data-x="' + i + '">×</button></div>';
  }

  function renderPhotoPrevs() {
    var all = (editing.photos || []).concat(pendingPhotos);
    $("photo-prevs").innerHTML = all.map(function (u, i) {
      return '<div class="pv"><img src="' + esc(u) + '"><button class="x" data-pi="' + i + '">×</button></div>';
    }).join("");
  }

  function fileToResizedDataUri(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1000, w = img.width, h = img.height;
        if (w > max) { h = Math.round(h * max / w); w = max; }
        var c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        cb(c.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = function () { cb(null); };
      img.src = reader.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  }

  function saveEdit() {
    var id = ($("f-id").value || "").trim();
    if (!id) { toast("请填写箱子编号"); return; }
    // 重名校验：排除自己（编辑时正在改的那条）
    var dup = boxes.some(function (b) { return b.id === id && b.id !== editOrigId; });
    if (dup) { toast("编号 " + id + " 已存在，换个编号"); return; }

    editing.id = id;
    editing.name = ($("f-name").value || "").trim();
    editing.location = ($("f-loc").value || "").trim();
    editing.note = ($("f-note").value || "").trim();
    // 收集物品
    editing.items = [];
    $("item-rows").querySelectorAll(".item-row").forEach(function (row) {
      var nm = row.querySelector(".ir-name").value.trim();
      if (!nm) return;
      editing.items.push({
        name: nm,
        qty: row.querySelector(".ir-qty").value.trim(),
        note: row.querySelector(".ir-note").value.trim()
      });
    });
    editing.photos = (editing.photos || []).concat(pendingPhotos);
    editing.updatedAt = new Date().toISOString();

    var list = boxes.slice();
    // 定位原记录：改过编号时按 editOrigId 找（否则会变成"新增一条 + 旧的残留"）
    var i = -1;
    for (var k = 0; k < list.length; k++) {
      if ((editOrigId && list[k].id === editOrigId) || list[k].id === id) { i = k; break; }
    }
    if (i >= 0) list[i] = editing; else list.push(editing);
    boxes = list;
    $("edit-modal").classList.add("hidden");
    renderList();
    saveBoxes();
  }

  /* ---------------- 二维码 ---------------- */
  function openQR(id) {
    if (typeof qrcode === "undefined") { toast("二维码库未加载，请刷新页面"); return; }
    var link = new URL("view.html?id=" + encodeURIComponent(id), location.href).href;
    try {
      var qr = qrcode(0, "M");
      qr.addData(link);
      qr.make();
      $("qr-img").src = qr.createDataURL(8, 10);
      $("qr-link").textContent = link;
      $("btn-qr-dl").href = $("qr-img").src;
      $("qr-title").textContent = "二维码 · " + id;
      $("qr-modal").classList.remove("hidden");
    } catch (e) { toast("生成二维码失败：" + (e.message || e)); }
  }

  /* ---------------- 弹窗/设置 ---------------- */
  function openSettings() {
    var cfg = getGh();
    $("cfg-repo").value = cfg.repo || "";
    $("cfg-branch").value = cfg.branch || "main";
    $("cfg-token").value = cfg.token || "";
    $("settings-modal").classList.remove("hidden");
  }

  function exportBackup() {
    var blob = new Blob([JSON.stringify(boxes, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "storage-qr-backup.json";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    toast("已导出备份");
  }
  function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var list = JSON.parse(reader.result);
        if (!Array.isArray(list)) throw new Error("格式错误");
        boxes = list; renderList(); saveBoxes();
        toast("已导入并保存");
      } catch (e) { toast("导入失败：" + (e.message || e)); }
    };
    reader.readAsText(file);
  }

  /* ---------------- 通用 ---------------- */
  var toastTimer = null;
  function toast(msg, ms) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add("hidden"); }, ms || 2600);
  }

  function bind() {
    $("btn-add").onclick = function () { openEdit(null); };
    $("btn-settings").onclick = openSettings;
    $("btn-cfg-cancel").onclick = function () { $("settings-modal").classList.add("hidden"); };
    $("btn-cfg-save").onclick = function () {
      setGh({ repo: ($("cfg-repo").value || "").trim(), branch: ($("cfg-branch").value || "main").trim(), token: ($("cfg-token").value || "").trim() });
      $("settings-modal").classList.add("hidden");
      toast("GitHub 设置已保存（本机）");
    };
    $("btn-export").onclick = exportBackup;
    $("btn-import").onclick = function () { $("f-import").click(); };
    $("f-import").onchange = function () { if (this.files[0]) importBackup(this.files[0]); this.value = ""; };

    $("box-list").onclick = function (e) {
      var btn = e.target.closest("button[data-act]");
      if (!btn) return;
      var card = e.target.closest(".box-card");
      var id = card.getAttribute("data-id");
      var act = btn.getAttribute("data-act");
      if (act === "qr") openQR(id);
      else if (act === "edit") openEdit(id);
      else if (act === "del") {
        if (confirm("确定删除箱子 " + id + "？")) { boxes = boxes.filter(function (b) { return b.id !== id; }); renderList(); saveBoxes(); }
      }
    };

    $("btn-edit-cancel").onclick = function () { $("edit-modal").classList.add("hidden"); };
    // 防连点：连点两次会用同一个旧 sha 提交，第二次必被 GitHub 拒（409 冲突）
    $("btn-edit-save").onclick = function () {
      if (saving) return;
      saving = true;
      saveEdit();
      setTimeout(function () { saving = false; }, 1200);
    };
    $("btn-del").onclick = function () {
      if (editing && editing.id && confirm("确定删除箱子 " + editing.id + "？")) {
        boxes = boxes.filter(function (b) { return b.id !== editing.id; });
        $("edit-modal").classList.add("hidden");
        renderList(); saveBoxes();
      }
    };
    $("btn-add-item").onclick = function () {
      var rows = $("item-rows");
      var i = rows.children.length;
      rows.insertAdjacentHTML("beforeend", itemRowHtml(i, "", "", ""));
    };
    $("item-rows").onclick = function (e) {
      if (e.target.classList.contains("ir-x")) {
        var card = e.target.closest(".item-row");
        if (card) card.remove();
      }
    };
    $("f-photo").onchange = function () {
      var files = Array.prototype.slice.call(this.files || []);
      var pending = files.length;
      if (!pending) return;
      files.forEach(function (f) {
        fileToResizedDataUri(f, function (uri) {
          if (uri) pendingPhotos.push(uri);
          if (--pending === 0) renderPhotoPrevs();
        });
      });
      this.value = "";
    };
    $("photo-prevs").onclick = function (e) {
      if (e.target.classList.contains("x")) {
        var i = Number(e.target.getAttribute("data-pi"));
        var base = (editing.photos || []).length;
        if (i < base) (editing.photos || []).splice(i, 1);
        else pendingPhotos.splice(i - base, 1);
        renderPhotoPrevs();
      }
    };

    $("btn-qr-close").onclick = function () { $("qr-modal").classList.add("hidden"); };
  }

  document.addEventListener("DOMContentLoaded", function () {
    bind();
    loadBoxes();
  });
})();
