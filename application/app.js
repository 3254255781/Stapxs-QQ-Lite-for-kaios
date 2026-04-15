var contacts = [
  { id: "sys", type: "system", name: "系统消息", messages: [{ text: "欢迎使用 QQ Lite (KaiOS)。", self: false }] }
];

var menuItems = [
  { id: "setUrl", label: "设置地址" },
  { id: "setToken", label: "设置Token" },
  { id: "connect", label: "连接OneBot" },
  { id: "disconnect", label: "断开连接" },
  { id: "reconnect", label: "重新连接" },
  { id: "about", label: "关于" }
];

var state = {
  activeContactIndex: 0,
  contactFocusIndex: 0,
  focusKey: "contact:0",
  menuFocusIndex: 0,
  mode: "list",
  ws: null,
  wsConnected: false,
  wsConnecting: false,
  requestEcho: 1,
  wsPending: {},
  seenMessageIds: {},
  connectedAtSec: 0,
  sectionsCollapsed: {
    private: false,
    group: false,
    system: false
  },
  sidebarCollapsed: false,
  chatFocusArea: "input",
  imageFocusIndex: -1,
  config: {
    wsUrl: "ws://127.0.0.1:6700/",
    accessToken: ""
  }
};

var dom = {
  status: document.getElementById("status"),
  contactList: document.getElementById("contactList"),
  chatTitle: document.getElementById("chatTitle"),
  messageList: document.getElementById("messageList"),
  form: document.getElementById("composerForm"),
  input: document.getElementById("messageInput"),
  softLeft: document.getElementById("softLeftLabel"),
  softCenter: document.getElementById("softCenterLabel"),
  softRight: document.getElementById("softRightLabel"),
  menuLayer: document.getElementById("menuLayer"),
  menuList: document.getElementById("menuList"),
  content: document.querySelector(".content")
};

function hasClass(el, className) {
  return (" " + el.className + " ").indexOf(" " + className + " ") > -1;
}

function addClass(el, className) {
  if (!hasClass(el, className)) {
    el.className = (el.className ? el.className + " " : "") + className;
  }
}

function removeClass(el, className) {
  var reg = new RegExp("(^|\\s)" + className + "(\\s|$)", "g");
  el.className = el.className.replace(reg, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
}

function setSoftkeys(left, center, right) {
  dom.softLeft.innerHTML = left;
  dom.softCenter.innerHTML = center;
  dom.softRight.innerHTML = right;
}

function updateChatSoftkeys() {
  if (state.mode !== "input") {
    return;
  }
  if (state.chatFocusArea === "messages") {
    setSoftkeys("菜单", "发送", "侧栏");
  } else {
    setSoftkeys("菜单", "发送", "侧栏");
  }
}

function trimText(value) {
  return value.replace(/^\s+|\s+$/g, "");
}

function htmlEscape(text) {
  var str = String(text);
  str = str.replace(/&/g, "&amp;");
  str = str.replace(/</g, "&lt;");
  str = str.replace(/>/g, "&gt;");
  str = str.replace(/"/g, "&quot;");
  return str.replace(/'/g, "&#39;");
}

function loadConfig() {
  var saved = null;
  try {
    saved = window.localStorage.getItem("onebotConfig");
  } catch (e) {
    saved = null;
  }
  if (!saved) {
    return;
  }
  try {
    saved = JSON.parse(saved);
    if (saved.wsUrl) {
      state.config.wsUrl = saved.wsUrl;
    }
    if (typeof saved.accessToken === "string") {
      state.config.accessToken = saved.accessToken;
    }
  } catch (e2) {
    pushSystemMessage("配置读取失败，已使用默认地址");
  }
}

function saveConfig() {
  try {
    window.localStorage.setItem("onebotConfig", JSON.stringify(state.config));
  } catch (e) {}
}

function setStatus(text) {
  dom.status.innerHTML = htmlEscape(text);
}

function pushSystemMessage(text) {
  var idx = 0;
  contacts[idx].messages.push({ text: text, self: false });
  if (state.activeContactIndex === idx) {
    appendMessage(text, false);
  }
}

function findContactIndexById(type, id) {
  var i;
  for (i = 0; i < contacts.length; i++) {
    if (contacts[i].type === type && String(contacts[i].id) === String(id)) {
      return i;
    }
  }
  return -1;
}

function ensureContact(type, id, name, skipRender) {
  var idx = findContactIndexById(type, id);
  if (idx >= 0) {
    if (name) {
      contacts[idx].name = name;
    }
    return idx;
  }
  contacts.push({
    id: String(id),
    type: type,
    name: name || (type === "group" ? "群 " + id : "用户 " + id),
    messages: []
  });
  if (!skipRender) {
    renderContacts();
  }
  return contacts.length - 1;
}

function renderContacts() {
  var i;
  var li;
  var privates = [];
  var groups = [];
  var systems = [];
  var c;
  dom.contactList.innerHTML = "";
  for (i = 0; i < contacts.length; i++) {
    c = contacts[i];
    if (c.type === "group") {
      groups.push({ index: i, contact: c });
    } else if (c.type === "private") {
      privates.push({ index: i, contact: c });
    } else {
      systems.push({ index: i, contact: c });
    }
  }

  function appendSection(title, rows, sectionKey) {
    var j;
    var row;
    var last;
    var titleLi = document.createElement("li");
    titleLi.className = "section-title";
    titleLi.setAttribute("data-focus", "section:" + sectionKey);
    titleLi.setAttribute("data-section", sectionKey);
    titleLi.innerHTML = htmlEscape((state.sectionsCollapsed[sectionKey] ? "▶ " : "▼ ") + title);
    dom.contactList.appendChild(titleLi);
    if (state.sectionsCollapsed[sectionKey]) {
      return;
    }
    if (!rows.length) {
      li = document.createElement("li");
      li.className = "focus-item";
      li.setAttribute("data-focus", "section:" + sectionKey);
      li.innerHTML = htmlEscape("（空）");
      dom.contactList.appendChild(li);
      return;
    }
    for (j = 0; j < rows.length; j++) {
      row = rows[j];
      last = row.contact.messages.length ? row.contact.messages[row.contact.messages.length - 1].text : "暂无新消息";
      li = document.createElement("li");
      li.className = "focus-item";
      li.setAttribute("data-index", String(row.index));
      li.setAttribute("data-focus", "contact:" + String(row.index));
      li.innerHTML = htmlEscape(row.contact.name + " - " + String(last).replace(/\s+/g, " ").slice(0, 18));
      dom.contactList.appendChild(li);
    }
  }
  appendSection("私聊", privates, "private");
  appendSection("群聊", groups, "group");
  if (systems.length) {
    appendSection("系统", systems, "system");
  }
  ensureFocusOnVisibleContact();
  paintContactFocus();
}

function getVisibleContactIndices() {
  var i;
  var result = [];
  for (i = 0; i < contacts.length; i++) {
    if (contacts[i].type === "private" && state.sectionsCollapsed.private) continue;
    if (contacts[i].type === "group" && state.sectionsCollapsed.group) continue;
    if (contacts[i].type === "system" && state.sectionsCollapsed.system) continue;
    result.push(i);
  }
  return result;
}

function ensureFocusOnVisibleContact() {
  var visible = getVisibleContactIndices();
  if (!visible.length) {
    state.contactFocusIndex = 0;
    return;
  }
  if (visible.indexOf(state.contactFocusIndex) < 0) {
    state.contactFocusIndex = visible[0];
  }
  if (visible.indexOf(state.activeContactIndex) < 0) {
    state.activeContactIndex = visible[0];
  }
  if (state.focusKey.indexOf("contact:") !== 0) {
    return;
  }
  if (visible.indexOf(state.contactFocusIndex) < 0) {
    state.focusKey = "contact:" + String(visible[0]);
  }
}

function paintContactFocus() {
  var items = dom.contactList.querySelectorAll("li[data-focus]");
  var i;
  for (i = 0; i < items.length; i++) {
    removeClass(items[i], "focused");
    removeClass(items[i], "active");
    if (items[i].getAttribute("data-focus") === state.focusKey) {
      addClass(items[i], "focused");
    }
    if (parseInt(items[i].getAttribute("data-index"), 10) === state.activeContactIndex) {
      addClass(items[i], "active");
    }
  }
  keepFocusedContactVisible();
}

function keepFocusedContactVisible() {
  var target = dom.contactList.querySelector('li[data-focus="' + state.focusKey + '"]');
  var containerTop;
  var containerBottom;
  var targetTop;
  var targetBottom;
  if (!target) {
    return;
  }
  containerTop = dom.contactList.scrollTop;
  containerBottom = containerTop + dom.contactList.clientHeight;
  targetTop = target.offsetTop;
  targetBottom = targetTop + target.offsetHeight;
  if (targetTop < containerTop) {
    dom.contactList.scrollTop = targetTop;
  } else if (targetBottom > containerBottom) {
    dom.contactList.scrollTop = targetBottom - dom.contactList.clientHeight;
  }
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  if (state.sidebarCollapsed) {
    addClass(dom.content, "sidebar-collapsed");
    setStatus("侧边栏已收起");
  } else {
    removeClass(dom.content, "sidebar-collapsed");
    setStatus(state.wsConnected ? "OneBot 已连接" : "OneBot 未连接");
  }
}

function toggleCurrentSectionCollapse() {
  var current = contacts[state.contactFocusIndex];
  var key;
  if (!current) {
    if (state.sectionsCollapsed.private) key = "private";
    else if (state.sectionsCollapsed.group) key = "group";
    else if (state.sectionsCollapsed.system) key = "system";
    else key = "private";
  } else {
    key = current.type === "group" ? "group" : current.type === "system" ? "system" : "private";
    // When focus is on system while private/group are collapsed,
    // prioritize expanding chat sections first.
    if (key === "system") {
      if (state.sectionsCollapsed.private) key = "private";
      else if (state.sectionsCollapsed.group) key = "group";
    }
  }
  state.sectionsCollapsed[key] = !state.sectionsCollapsed[key];
  state.focusKey = "section:" + key;
  renderContacts();
}

function appendMessage(text, isSelf) {
  var div = document.createElement("div");
  div.className = "msg" + (isSelf ? " self" : "");
  div.innerHTML = htmlEscape(text);
  dom.messageList.appendChild(div);
  dom.messageList.scrollTop = dom.messageList.scrollHeight;
}

function appendImageMessage(text, imageUrls, isSelf) {
  var div = document.createElement("div");
  var i;
  var line;
  var img;
  div.className = "msg" + (isSelf ? " self" : "");
  if (text) {
    line = document.createElement("div");
    line.className = "msg-text";
    line.innerHTML = htmlEscape(text);
    div.appendChild(line);
  }
  for (i = 0; i < imageUrls.length; i++) {
    img = document.createElement("img");
    img.className = "msg-image";
    img.setAttribute("tabindex", "-1");
    img.src = imageUrls[i];
    img.alt = "图片消息";
    img.onerror = (function (target) {
      return function () {
        target.alt = "图片加载失败";
        addClass(target, "error");
      };
    })(img);
    div.appendChild(img);
  }
  dom.messageList.appendChild(div);
  dom.messageList.scrollTop = dom.messageList.scrollHeight;
}

function getImageNodes() {
  return dom.messageList.querySelectorAll(".msg-image");
}

function paintImageFocus() {
  var imgs = getImageNodes();
  var i;
  for (i = 0; i < imgs.length; i++) {
    removeClass(imgs[i], "focused");
    if (state.chatFocusArea === "messages" && i === state.imageFocusIndex) {
      addClass(imgs[i], "focused");
      try {
        imgs[i].focus();
      } catch (e) {}
    }
  }
}

function ensureImageFocusInRange() {
  var imgs = getImageNodes();
  if (!imgs.length) {
    state.imageFocusIndex = -1;
    return;
  }
  if (state.imageFocusIndex < 0) state.imageFocusIndex = 0;
  if (state.imageFocusIndex >= imgs.length) state.imageFocusIndex = imgs.length - 1;
}

function moveImageFocus(step) {
  var imgs = getImageNodes();
  if (!imgs.length) {
    scrollMessages(step);
    return;
  }
  ensureImageFocusInRange();
  state.imageFocusIndex += step;
  if (state.imageFocusIndex < 0) state.imageFocusIndex = 0;
  if (state.imageFocusIndex >= imgs.length) state.imageFocusIndex = imgs.length - 1;
  paintImageFocus();
  try {
    imgs[state.imageFocusIndex].scrollIntoView(false);
  } catch (e) {}
}

function scrollMessages(step) {
  dom.messageList.scrollTop += step * 40;
}

function switchChatFocus(area) {
  state.chatFocusArea = area;
  if (area === "input") {
    try {
      dom.input.focus();
    } catch (e) {}
  } else {
    dom.input.blur();
    ensureImageFocusInRange();
    paintImageFocus();
  }
  updateChatSoftkeys();
}

function openChat(index) {
  var i;
  var current;
  state.activeContactIndex = index;
  state.contactFocusIndex = index;
  state.focusKey = "contact:" + String(index);
  current = contacts[index];
  dom.chatTitle.innerHTML = htmlEscape("会话 - " + current.name);
  dom.messageList.innerHTML = "";
  for (i = 0; i < current.messages.length; i++) {
    if (current.messages[i].kind === "image" && current.messages[i].images && current.messages[i].images.length) {
      appendImageMessage(current.messages[i].text, current.messages[i].images, !!current.messages[i].self);
    } else {
      appendMessage(current.messages[i].text, !!current.messages[i].self);
    }
  }
  paintContactFocus();
  enterInputMode();
}

function addChatMessage(contactIndex, text, isSelf) {
  contacts[contactIndex].messages.push({ text: text, self: isSelf, kind: "text" });
  if (state.activeContactIndex === contactIndex) {
    appendMessage(text, isSelf);
  }
}

function parseOneBotMessage(message) {
  var i;
  var seg;
  var data;
  var out = [];
  var images = [];
  var text;
  if (typeof message === "string") {
    return { text: message, images: [] };
  }
  if (!message) {
    return { text: "", images: [] };
  }
  if (!Array.isArray(message)) {
    if (typeof message.text === "string") return { text: message.text, images: [] };
    if (message.message) return parseOneBotMessage(message.message);
    if (typeof message === "object") {
      try {
        return { text: JSON.stringify(message), images: [] };
      } catch (e) {
        return { text: "[消息对象]", images: [] };
      }
    }
    return { text: String(message), images: [] };
  }
  for (i = 0; i < message.length; i++) {
    seg = message[i] || {};
    data = seg.data || {};
    if (seg.type === "text") out.push(String(data.text || ""));
    else if (seg.type === "image") {
      out.push("[图片]");
      if (data.url) {
        images.push(String(data.url));
      } else if (data.file && /^https?:\/\//i.test(String(data.file))) {
        images.push(String(data.file));
      }
    }
    else if (seg.type === "file") out.push("[文件]");
    else if (seg.type === "at") out.push("@" + (data.qq || data.id || "用户"));
    else if (seg.type === "reply") out.push("[回复]");
    else out.push("[" + (seg.type || "消息") + "]");
  }
  text = out.join(" ");
  return { text: text, images: images };
}

function getSenderName(sender) {
  if (!sender) return "";
  if (typeof sender === "string") return sender;
  return sender.card || sender.nickname || sender.name || "";
}

function wsCall(action, params) {
  return new Promise(function (resolve, reject) {
    var echo;
    var timer;
    if (!state.wsConnected || !state.ws) {
      reject(new Error("WS未连接"));
      return;
    }
    echo = "req_" + String(state.requestEcho++);
    timer = setTimeout(function () {
      if (state.wsPending[echo]) {
        delete state.wsPending[echo];
        reject(new Error("请求超时"));
      }
    }, 8000);
    state.wsPending[echo] = { resolve: resolve, reject: reject, timer: timer };
    state.ws.send(JSON.stringify({ action: action, params: params || {}, echo: echo }));
  });
}

function loadContactsFromOneBot() {
  function appendBatch(type, arr, idKeys, nameKeys, doneText) {
    var idx = 0;
    function pick(obj, keys) {
      var k;
      for (k = 0; k < keys.length; k++) {
        if (typeof obj[keys[k]] !== "undefined" && obj[keys[k]] !== null && obj[keys[k]] !== "") {
          return obj[keys[k]];
        }
      }
      return "";
    }
    function step() {
      var end = Math.min(idx + 30, arr.length);
      var i;
      for (i = idx; i < end; i++) {
        ensureContact(
          type,
          pick(arr[i], idKeys),
          pick(arr[i], nameKeys),
          true
        );
      }
      idx = end;
      renderContacts();
      if (idx < arr.length) {
        setTimeout(step, 0);
      } else if (doneText) {
        pushSystemMessage(doneText + " " + String(arr.length) + " 条");
      }
    }
    if (!arr.length) return;
    step();
  }

  wsCall("get_friend_list", {}).then(function (ret) {
    var arr = (ret && ret.data && ret.data.length) ? ret.data : [];
    appendBatch("private", arr, ["user_id", "userId", "id"], ["remark", "nickname", "name"], "私聊已载入");
  }).catch(function () {});

  wsCall("get_group_list", {}).then(function (ret) {
    var arr = (ret && ret.data && ret.data.length) ? ret.data : [];
    appendBatch("group", arr, ["group_id", "groupId", "id"], ["group_name", "groupName", "name"], "群聊已载入");
  }).catch(function () {});
}

function buildWsUrlWithToken() {
  var base = trimText(state.config.wsUrl || "");
  var token = trimText(state.config.accessToken || "");
  if (!base) {
    return "";
  }
  if (!token) {
    return base;
  }
  if (base.indexOf("?") >= 0) {
    return base + "&access_token=" + encodeURIComponent(token);
  }
  return base + "?access_token=" + encodeURIComponent(token);
}

function setConnectStatusText() {
  if (state.wsConnected) {
    setStatus("OneBot 已连接");
    return;
  }
  if (state.wsConnecting) {
    setStatus("OneBot 连接中...");
    return;
  }
  setStatus("OneBot 未连接");
}

function onWsMessage(raw) {
  var payload = null;
  var postType;
  var messageType;
  var senderName;
  var groupName;
  var targetType;
  var targetId;
  var idx;
  var pending;
  var msgId;
  var msgTime;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    pushSystemMessage("收到非JSON消息");
    return;
  }

  if (payload.echo && state.wsPending[payload.echo]) {
    pending = state.wsPending[payload.echo];
    delete state.wsPending[payload.echo];
    clearTimeout(pending.timer);
    if (payload.status === "ok" || payload.retcode === 0 || typeof payload.retcode === "undefined") {
      pending.resolve(payload);
    } else {
      pending.reject(new Error(payload.msg || "请求失败"));
    }
    return;
  }

  postType = payload.post_type || "";
  if (postType !== "message") {
    return;
  }
  msgId = payload.message_id || payload.messageId || "";
  if (msgId) {
    if (state.seenMessageIds[msgId]) {
      return;
    }
    state.seenMessageIds[msgId] = 1;
  }
  msgTime = Number(payload.time || 0);
  if (msgTime && state.connectedAtSec && msgTime < state.connectedAtSec) {
    return;
  }

  messageType = payload.message_type || "private";
  if (messageType === "group") {
    targetType = "group";
    targetId = payload.group_id;
    senderName = getSenderName(payload.sender) || "群成员";
    groupName = payload.group_name || payload.groupName || "";
  } else {
    targetType = "private";
    targetId = payload.user_id;
    senderName = getSenderName(payload.sender) || ("用户 " + payload.user_id);
    groupName = "";
  }

  idx = ensureContact(targetType, targetId, targetType === "group" ? (groupName || ("群 " + targetId)) : senderName);
  var parsed = parseOneBotMessage(payload.message);
  var messageText = (targetType === "group" ? senderName + ": " : "") + parsed.text;
  if (parsed.images && parsed.images.length) {
    contacts[idx].messages.push({
      text: messageText,
      self: false,
      kind: "image",
      images: parsed.images
    });
    if (state.activeContactIndex === idx) {
      appendImageMessage(messageText, parsed.images, false);
    }
  } else {
    addChatMessage(idx, messageText, false);
  }
  renderContacts();
}

function connectOneBot() {
  var finalUrl;
  if (state.wsConnected || state.wsConnecting) {
    return;
  }
  finalUrl = buildWsUrlWithToken();
  if (!finalUrl) {
    pushSystemMessage("请先设置有效的 OneBot 地址");
    return;
  }

  try {
    state.wsConnecting = true;
    setConnectStatusText();
    state.ws = new WebSocket(finalUrl);
  } catch (e) {
    state.wsConnecting = false;
    setConnectStatusText();
    pushSystemMessage("连接失败: " + e.message);
    return;
  }

  state.ws.onopen = function () {
    state.wsConnecting = false;
    state.wsConnected = true;
    state.connectedAtSec = Math.floor(Date.now() / 1000);
    state.seenMessageIds = {};
    setConnectStatusText();
    pushSystemMessage("OneBot 连接成功");
    loadContactsFromOneBot();
  };

  state.ws.onmessage = function (event) {
    onWsMessage(event.data);
  };

  state.ws.onclose = function () {
    state.wsConnected = false;
    state.wsConnecting = false;
    setConnectStatusText();
    pushSystemMessage("OneBot 连接已断开");
  };

  state.ws.onerror = function () {
    pushSystemMessage("OneBot 连接错误");
  };
}

function disconnectOneBot() {
  if (state.ws) {
    try {
      state.ws.close();
    } catch (e) {}
  }
  state.ws = null;
  state.wsConnected = false;
  state.wsConnecting = false;
  setConnectStatusText();
}

function reconnectOneBot() {
  disconnectOneBot();
  connectOneBot();
}

function sendMessageToOneBot(contact, text) {
  var payload;
  if (!state.wsConnected || !state.ws) {
    pushSystemMessage("未连接 OneBot，消息仅本地显示");
    return;
  }
  if (contact.type === "system") {
    return;
  }
  payload = {
    action: contact.type === "group" ? "send_group_msg" : "send_private_msg",
    params: {},
    echo: "msg_" + String(state.requestEcho++)
  };
  if (contact.type === "group") {
    payload.params.group_id = parseInt(contact.id, 10);
  } else {
    payload.params.user_id = parseInt(contact.id, 10);
  }
  payload.params.message = text;
  state.ws.send(JSON.stringify(payload));
}

function sendMessage() {
  var value = trimText(dom.input.value || "");
  var current;
  if (!value) {
    return;
  }
  current = contacts[state.activeContactIndex];
  addChatMessage(state.activeContactIndex, value, true);
  sendMessageToOneBot(current, value);
  dom.input.value = "";
}

function moveContactFocus(step) {
  var focusItems = dom.contactList.querySelectorAll("li[data-focus]");
  var i;
  var pos = 0;
  if (!focusItems.length) return;
  for (i = 0; i < focusItems.length; i++) {
    if (focusItems[i].getAttribute("data-focus") === state.focusKey) {
      pos = i;
      break;
    }
  }
  pos += step;
  if (pos < 0) pos = 0;
  if (pos >= focusItems.length) pos = focusItems.length - 1;
  state.focusKey = focusItems[pos].getAttribute("data-focus");
  if (state.focusKey.indexOf("contact:") === 0) {
    state.contactFocusIndex = parseInt(state.focusKey.split(":")[1], 10);
  }
  paintContactFocus();
}

function renderMenu() {
  var i;
  var li;
  dom.menuList.innerHTML = "";
  for (i = 0; i < menuItems.length; i++) {
    li = document.createElement("li");
    li.className = "menu-item";
    li.innerHTML = htmlEscape(menuItems[i].label);
    dom.menuList.appendChild(li);
  }
  paintMenuFocus();
}

function paintMenuFocus() {
  var items = dom.menuList.getElementsByTagName("li");
  var i;
  for (i = 0; i < items.length; i++) {
    removeClass(items[i], "focused");
    if (i === state.menuFocusIndex) {
      addClass(items[i], "focused");
    }
  }
}

function openMenu() {
  state.mode = "menu";
  dom.menuLayer.setAttribute("aria-hidden", "false");
  removeClass(dom.menuLayer, "hidden");
  setSoftkeys("关闭", "确定", "返回");
}

function closeMenu() {
  state.mode = "list";
  dom.menuLayer.setAttribute("aria-hidden", "true");
  addClass(dom.menuLayer, "hidden");
  setSoftkeys("菜单", "选择", "侧栏");
}

function executeMenuAction() {
  var item = menuItems[state.menuFocusIndex];
  var newValue;
  if (!item) {
    return;
  }

  if (item.id === "setUrl") {
    newValue = window.prompt("OneBot WS地址", state.config.wsUrl);
    if (newValue !== null) {
      state.config.wsUrl = trimText(newValue);
      saveConfig();
      pushSystemMessage("地址已设置: " + state.config.wsUrl);
    }
  } else if (item.id === "setToken") {
    newValue = window.prompt("Access Token(可空)", state.config.accessToken);
    if (newValue !== null) {
      state.config.accessToken = trimText(newValue);
      saveConfig();
      pushSystemMessage("Token 已更新");
    }
  } else if (item.id === "connect") {
    connectOneBot();
  } else if (item.id === "disconnect") {
    disconnectOneBot();
    pushSystemMessage("已手动断开");
  } else if (item.id === "reconnect") {
    reconnectOneBot();
  } else if (item.id === "about") {
    pushSystemMessage("OneBot v11 WS 客户端");
  }
  closeMenu();
}

function enterInputMode() {
  state.mode = "input";
  switchChatFocus("input");
}

function exitInputMode() {
  state.mode = "list";
  dom.input.blur();
  state.chatFocusArea = "input";
  state.imageFocusIndex = -1;
  paintImageFocus();
  setSoftkeys("菜单", "选择", "侧栏");
}

function keyInList(key, list) {
  var i;
  for (i = 0; i < list.length; i++) {
    if (key === list[i]) {
      return true;
    }
  }
  return false;
}

function mapKaiOSKey(event) {
  var key = event.key || "";
  var code = event.keyCode;
  var softLeftKeys = ["SoftLeft", "F1", "ContextMenu", "MozSoftLeft"];
  var softRightKeys = ["SoftRight", "F2", "BrowserBack", "MozSoftRight"];
  var centerKeys = ["Enter", "OK", "Accept"];
  var upKeys = ["ArrowUp", "Up", "2"];
  var downKeys = ["ArrowDown", "Down", "8"];
  var leftKeys = ["ArrowLeft", "Left", "4"];
  var rightKeys = ["ArrowRight", "Right", "6"];
  var backKeys = ["Backspace", "EndCall", "GoBack"];

  if (keyInList(key, softLeftKeys) || code === 112) return "softLeft";
  if (keyInList(key, softRightKeys) || code === 113) return "softRight";
  if (keyInList(key, centerKeys) || code === 13) return "center";
  if (keyInList(key, upKeys) || code === 38) return "up";
  if (keyInList(key, downKeys) || code === 40) return "down";
  if (keyInList(key, leftKeys) || code === 37) return "left";
  if (keyInList(key, rightKeys) || code === 39) return "right";
  if (keyInList(key, backKeys) || code === 8) return "back";
  return "";
}

function moveMenuFocus(step) {
  var max = menuItems.length - 1;
  var next = state.menuFocusIndex + step;
  if (next < 0) {
    next = 0;
  }
  if (next > max) {
    next = max;
  }
  state.menuFocusIndex = next;
  paintMenuFocus();
}

function onKeyDown(event) {
  var action = mapKaiOSKey(event);
  if (!action) {
    return;
  }

  event.preventDefault();

  if (state.mode === "menu") {
    if (action === "up") moveMenuFocus(-1);
    if (action === "down") moveMenuFocus(1);
    if (action === "center" || action === "softLeft") executeMenuAction();
    if (action === "softRight" || action === "back" || action === "left") closeMenu();
    return;
  }

  if (state.mode === "input") {
    if (action === "center") sendMessage();
    if (action === "up") {
      if (state.chatFocusArea === "messages") moveImageFocus(-1);
      else scrollMessages(-1);
    }
    if (action === "down") {
      if (state.chatFocusArea === "messages") moveImageFocus(1);
      else scrollMessages(1);
    }
    if (action === "softRight") toggleSidebar();
    if (action === "back") exitInputMode();
    if (action === "left") switchChatFocus("input");
    if (action === "right") switchChatFocus("messages");
    if (action === "softLeft") openMenu();
    return;
  }

  if (action === "up") moveContactFocus(-1);
  if (action === "down") moveContactFocus(1);
  if (action === "center") {
    if (state.focusKey.indexOf("section:") === 0) {
      // center on section only selects, no expand/collapse to avoid conflict
    } else {
      openChat(state.contactFocusIndex);
    }
  }
  if (action === "left") {
    if (state.focusKey.indexOf("section:") === 0) {
      state.sectionsCollapsed[state.focusKey.split(":")[1]] = !state.sectionsCollapsed[state.focusKey.split(":")[1]];
      renderContacts();
    } else {
      toggleCurrentSectionCollapse();
    }
  }
  if (action === "right") enterInputMode();
  if (action === "softLeft") openMenu();
  if (action === "softRight") {
    toggleSidebar();
  }
  if (action === "back") {
    pushSystemMessage("已拦截返回，避免直接退出,请强制退出长按返回键或者按电源键");
  }
}

function init() {
  loadConfig();
  renderContacts();
  renderMenu();
  openChat(0);
  closeMenu();
  setConnectStatusText();

  dom.form.addEventListener("submit", function (event) {
    event.preventDefault();
    sendMessage();
  });

  window.addEventListener("keydown", onKeyDown);
}

init();
