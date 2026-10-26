<?php
/**
 * 上传/延迟测速端点（对应 worker 的 url_ul 与 url_ping）
 *
 * 相对原版改动：
 *  1) 删除应用层设置的 Connection: keep-alive（hop-by-hop 头不应由应用设置，
 *     HTTP/2 下非法，HTTP/1.1 下也由容器管理）
 *  2) 补 X-Content-Type-Options: nosniff
 *  3) 显式 Content-Length: 0，并限制允许的请求方法
 *  4) 上传体积上限交由 httpd（LimitRequestBody）+ PHP 共同约束
 */

$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';

if ($method !== 'GET' && $method !== 'HEAD' && $method !== 'POST') {
    http_response_code(405);
    header('Allow: GET, HEAD, POST');
    header('X-Content-Type-Options: nosniff');
    exit;
}

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Content-Length: 0');

http_response_code(200);
exit;