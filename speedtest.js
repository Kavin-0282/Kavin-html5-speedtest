/* 网络测速前端逻辑
 * 相对原版改动：
 *  1) 从内联脚本外置，便于启用严格 CSP（script-src 'self'）
 *  2) Worker 路径常量集中管理，修正原版指向不存在文件的问题
 *  3) JSON.parse 加 try/catch，避免异常数据让 UI 卡死
 *  4) 移除 IP 展示逻辑（原版依赖不存在的 ip.php）
 *  5) 数值统一做有限性校验，避免 NaN 传入 canvas
 *  6) onclick 属性改为事件监听，支持键盘操作
 */
(function () {
	'use strict';

	// 如需更换 Worker 文件名，只改这一处
	var WORKER_URL = 'speedtest_worker.min.js';

	function I(id) { return document.getElementById(id); }

	var meterBk = '#E0E0E0';
	var dlColor = '#6060AA';
	var ulColor = '#309030';
	var pingColor = '#AA6060';
	var jitColor = '#AA6060';
	var progColor = '#EEEEEE';

	// 将任意输入安全转为有限数值
	function num(v) {
		var n = Number(v);
		return isFinite(n) ? n : 0;
	}

	function drawMeter(c, amount, bk, fg, progress, prog) {
		if (!c) { return; }
		var ctx = c.getContext('2d');
		if (!ctx) { return; }
		var dp = window.devicePixelRatio || 1;
		var cw = c.clientWidth * dp, ch = c.clientHeight * dp;
		var sizScale = ch * 0.0055;
		if (c.width === cw && c.height === ch) {
			ctx.clearRect(0, 0, cw, ch);
		} else {
			c.width = cw;
			c.height = ch;
		}
		var amt = num(amount);
		if (amt < 0) { amt = 0; }
		if (amt > 1) { amt = 1; }

		ctx.beginPath();
		ctx.strokeStyle = bk;
		ctx.lineWidth = 16 * sizScale;
		ctx.arc(c.width / 2, c.height - 58 * sizScale, c.height / 1.8 - ctx.lineWidth, -Math.PI * 1.1, Math.PI * 0.1);
		ctx.stroke();
		ctx.beginPath();
		ctx.strokeStyle = fg;
		ctx.lineWidth = 16 * sizScale;
		ctx.arc(c.width / 2, c.height - 58 * sizScale, c.height / 1.8 - ctx.lineWidth, -Math.PI * 1.1, amt * Math.PI * 1.2 - Math.PI * 1.1);
		ctx.stroke();
		if (typeof progress !== 'undefined') {
			ctx.fillStyle = prog;
			ctx.fillRect(c.width * 0.3, c.height - 16 * sizScale, c.width * 0.4 * num(progress), 4 * sizScale);
		}
	}

	function mbpsToAmount(s) { return 1 - (1 / (Math.pow(1.3, Math.sqrt(s)))); }
	function msToAmount(s) { return 1 - (1 / (Math.pow(1.08, Math.sqrt(s)))); }

	var w = null;      // speedtest worker
	var data = null;   // 来自 worker 的最新状态

	function setError(msg) {
		var el = I('errorHint');
		if (!el) { return; }
		if (msg) {
			el.textContent = msg;
			el.hidden = false;
		} else {
			el.textContent = '';
			el.hidden = true;
		}
	}

	function resetUI() {
		var btn = I('startStopBtn');
		if (btn) { btn.className = ''; }
	}

	function stopTest() {
		if (w !== null) {
			try { w.postMessage('abort'); } catch (e) { /* worker 已失效，忽略 */ }
			try { w.terminate(); } catch (e) { /* 忽略 */ }
		}
		w = null;
		data = null;
		resetUI();
		initUI();
	}

	function startTest() {
		var btn = I('startStopBtn');
		try {
			w = new Worker(WORKER_URL);
		} catch (err) {
			w = null;
			setError('无法启动测速组件：' + (err && err.message ? err.message : '未知错误'));
			resetUI();
			return;
		}

		w.onmessage = function (e) {
			var parsed;
			try {
				parsed = JSON.parse(e.data);
			} catch (err) {
				// 单条消息异常不应中断整体流程
				return;
			}
			if (!parsed || typeof parsed !== 'object') { return; }
			data = parsed;
			if (num(parsed.testState) >= 4) {
				resetUI();
				w = null;
				updateUI(true);
			}
		};

		w.onerror = function () {
			setError('测速组件加载失败，请确认 ' + WORKER_URL + ' 可访问且与页面同源。');
			stopTest();
		};

		try {
			w.postMessage('start');
		} catch (err) {
			setError('测速组件通信失败：' + (err && err.message ? err.message : '未知错误'));
			stopTest();
			return;
		}

		setError('');
		if (btn) { btn.className = 'running'; }
	}

	function startStop() {
		if (w !== null) { stopTest(); } else { startTest(); }
	}

	function updateUI(forced) {
		if (!forced && (!data || !w)) { return; }
		if (!data) { return; }
		var status = num(data.testState);

		var dlVal = num(data.dlStatus);
		I('dlText').textContent = (status === 1 && dlVal === 0) ? '...' : data.dlStatus;
		drawMeter(I('dlMeter'), mbpsToAmount(dlVal * (status === 1 ? oscillate() : 1)), meterBk, dlColor, num(data.dlProgress), progColor);

		var ulVal = num(data.ulStatus);
		I('ulText').textContent = (status === 3 && ulVal === 0) ? '...' : data.ulStatus;
		drawMeter(I('ulMeter'), mbpsToAmount(ulVal * (status === 3 ? oscillate() : 1)), meterBk, ulColor, num(data.ulProgress), progColor);

		var pingVal = num(data.pingStatus);
		I('pingText').textContent = data.pingStatus;
		drawMeter(I('pingMeter'), msToAmount(pingVal * (status === 2 ? oscillate() : 1)), meterBk, pingColor, num(data.pingProgress), progColor);

		var jitVal = num(data.jitterStatus);
		I('jitText').textContent = data.jitterStatus;
		drawMeter(I('jitMeter'), msToAmount(jitVal * (status === 2 ? oscillate() : 1)), meterBk, jitColor, num(data.pingProgress), progColor);
	}

	function oscillate() { return 1 + 0.02 * Math.sin(Date.now() / 100); }

	function initUI() {
		drawMeter(I('dlMeter'), 0, meterBk, dlColor, 0);
		drawMeter(I('ulMeter'), 0, meterBk, ulColor, 0);
		drawMeter(I('pingMeter'), 0, meterBk, pingColor, 0);
		drawMeter(I('jitMeter'), 0, meterBk, jitColor, 0);
		I('dlText').textContent = '';
		I('ulText').textContent = '';
		I('pingText').textContent = '';
		I('jitText').textContent = '';
	}

	function frame() {
		requestAnimationFrame(frame);
		updateUI();
	}

	function bindEvents() {
		var btn = I('startStopBtn');
		if (btn) {
			btn.addEventListener('click', startStop);
			btn.addEventListener('keydown', function (e) {
				if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
					e.preventDefault();
					startStop();
				}
			});
		}
		// 页面卸载时终止 worker，避免后台残留请求
		window.addEventListener('pagehide', function () {
			if (w !== null) {
				try { w.postMessage('abort'); } catch (e) { /* 忽略 */ }
				try { w.terminate(); } catch (e) { /* 忽略 */ }
			}
		});
	}

	/* ---------------- 页脚：当前系统IP ---------------- */
	// 浏览器无法直接读取本机 IP，必须由同源后端（ip.php）返回
	var IP_URL = 'ip.php';
	var IP_TIMEOUT = 3000;   // 3 秒未返回视为失败

	function setIpState(state, text) {
	var chip = I('ipChip');
	var val = I('ipVal');
	if (!chip || !val) { return; }
	chip.setAttribute('data-state', state);
	if (typeof text === 'string') { val.textContent = text; }
	}

	function isValidIp(s) {
	// 仅接受 IPv4 / IPv6 形态，避免异常内容被写入页面
	return /^[0-9a-fA-F:.]{2,45}$/.test(s) && /[:.]/.test(s);
	}

	function loadClientIp() {
	var chip = I('ipChip');
	if (!chip) { return; }

	var settled = false;
	var timer = setTimeout(function () {
	if (settled) { return; }
	settled = true;
	setIpState('fail', '获取失败');
	}, IP_TIMEOUT);

	function succeed(raw) {
	if (settled) { return; }
	var ip = String(raw || '').trim();
	settled = true;
	clearTimeout(timer);
	if (!isValidIp(ip)) {
	setIpState('fail', '获取失败');
	return;
	}
	setIpState('ok', ip);
	}

	function fail() {
	if (settled) { return; }
	settled = true;
	clearTimeout(timer);
	setIpState('fail', '获取失败');
	}

	if (typeof window.fetch === 'function') {
	window.fetch(IP_URL, { cache: 'no-store', credentials: 'same-origin' })
	.then(function (r) {
	if (!r.ok) { throw new Error('HTTP ' + r.status); }
	return r.text();
	})
	.then(succeed)
	.catch(fail);
	return;
	}

	// 兼容不支持 fetch 的旧浏览器（如 IE11）
	try {
	var xhr = new XMLHttpRequest();
	xhr.open('GET', IP_URL + (IP_URL.indexOf('?') === -1 ? '?' : '&') + 'r=' + Math.random(), true);
	xhr.timeout = IP_TIMEOUT;
	xhr.onload = function () {
	if (xhr.status === 200) { succeed(xhr.responseText); } else { fail(); }
	};
	xhr.onerror = fail;
	xhr.ontimeout = fail;
	xhr.send();
	} catch (err) {
	fail();
	}
	}
	function boot() {
		bindEvents();
		initUI();
		loadClientIp();
		// 每 200ms 向 worker 拉取一次状态
		setInterval(function () {
			if (w !== null) {
				try { w.postMessage('status'); } catch (e) { /* 忽略 */ }
			}
		}, 200);
		frame();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', boot);
	} else {
		boot();
	}
})();