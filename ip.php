<?php
/**
 * 客户端 IP 查询端点（供页脚「当前系统IP」使用）
 *
 * 设计要点：
 *  1) 只返回纯文本，供同源 fetch/XHR 读取，页面用 textContent 写入，不构成 XSS 面
 *  2) 结果做 IP 形态校验，非 IPv4/IPv6 一律返回 unknown
 *  3) 默认只信任 REMOTE_ADDR；X-Forwarded-For 可伪造，仅在明确配置可信代理后才采信
 *  4) 禁止缓存，避免反向代理把 A 的 IP 返给 B
 */

// ---- 可信代理白名单（按需填写前置代理/负载均衡的真实地址）----
// 例：$TRUSTED_PROXIES = array('10.10.0.5', '10.10.0.6');
$TRUSTED_PROXIES = array();

header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');

$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';
if ($method !== 'GET' && $method !== 'HEAD') {
    http_response_code(405);
    header('Allow: GET, HEAD');
    exit;
}

$remote = isset($_SERVER['REMOTE_ADDR']) ? trim($_SERVER['REMOTE_ADDR']) : '';

// 仅当直连方属于可信代理时，才采用 X-Forwarded-For 的第一个地址
if (!empty($TRUSTED_PROXIES) && in_array($remote, $TRUSTED_PROXIES, true) && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
    $parts = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
    $candidate = trim($parts[0]);
    if (filter_var($candidate, FILTER_VALIDATE_IP) !== false) {
        $remote = $candidate;
    }
}

// IPv4-mapped IPv6（::ffff:10.1.2.3）归一化为 IPv4
if (stripos($remote, '::ffff:') === 0) {
    $v4 = substr($remote, 7);
    if (filter_var($v4, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false) {
        $remote = $v4;
    }
}

if (filter_var($remote, FILTER_VALIDATE_IP) === false) {
    $remote = 'unknown';
}

echo $remote;