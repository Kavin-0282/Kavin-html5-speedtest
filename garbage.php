<?php
/**
 * 下载测速数据端点（对应 worker 的 url_dl）
 *
 * 相对原版改动：
 *  1) ckSize 上限 100 -> 25，并补上小于 1 的兜底
 *  2) 数据块改为磁盘缓存，不再每次请求都做加解密随机数生成（降低 CPU 开销）
 *  3) 增加同源校验（Referer 存在且与本站不一致时返回 403）
 *  4) 显式输出 Content-Length，并支持 HEAD
 *  5) 补 X-Content-Type-Options: nosniff
 *
 * 说明：文件名写死，无用户可控路径参与拼接，不存在目录遍历风险。
 */

// 关闭压缩，避免 mod_deflate 压缩随机数据导致 CPU 浪费与测速失真
@ini_set('zlib.output_compression', 'Off');
@ini_set('output_buffering', 'Off');
@ini_set('output_handler', '');

@set_time_limit(0);

define('CHUNK_SIZE', 1048576);   // 单个数据块 1MB
define('CHUNK_MAX', 25);         // 单请求最大块数（25MB）
define('CHUNK_DEF', 4);

header('X-Content-Type-Options: nosniff');
header('Content-Description: File Transfer');
header('Content-Type: application/octet-stream');
header('Content-Disposition: attachment; filename=random.dat');
header('Content-Transfer-Encoding: binary');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

// ---- 同源校验（软校验：无 Referer 时放行，避免代理剥离 Referer 导致误伤）----
if (!empty($_SERVER['HTTP_REFERER'])) {
    $refHost = parse_url($_SERVER['HTTP_REFERER'], PHP_URL_HOST);
    $selfHost = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : (isset($_SERVER['SERVER_NAME']) ? $_SERVER['SERVER_NAME'] : '');
    // 去掉端口，统一小写比较
    $selfHost = strtolower(preg_replace('/:\d+$/', '', $selfHost));
    if ($refHost !== null && $refHost !== false && $refHost !== '' && strtolower($refHost) !== $selfHost) {
        http_response_code(403);
        exit;
    }
}

// ---- 参数处理 ----
$chunks = isset($_GET['ckSize']) ? (int) $_GET['ckSize'] : CHUNK_DEF;
if ($chunks < 1) {
    $chunks = CHUNK_DEF;          // 原版对负数未做兜底
}
if ($chunks > CHUNK_MAX) {
    $chunks = CHUNK_MAX;
}

$total = CHUNK_SIZE * $chunks;
header('Content-Length: ' . $total);

// HEAD 请求只回头部（对应 worker 的健康探测）
if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'HEAD') {
    http_response_code(200);
    exit;
}

// ---- 数据来源：磁盘缓存，缺失时生成一次 ----
$cacheFile = __DIR__ . DIRECTORY_SEPARATOR . 'random_chunk.dat';

if (!is_file($cacheFile) || filesize($cacheFile) !== CHUNK_SIZE) {
    $bytes = null;
    if (function_exists('random_bytes')) {
        try {
            $bytes = random_bytes(CHUNK_SIZE);
        } catch (Exception $e) {
            $bytes = null;
        }
    }
    if (($bytes === null || strlen($bytes) !== CHUNK_SIZE) && function_exists('openssl_random_pseudo_bytes')) {
        $bytes = openssl_random_pseudo_bytes(CHUNK_SIZE);
    }
    if (is_string($bytes) && strlen($bytes) === CHUNK_SIZE) {
        $tmp = $cacheFile . '.' . getmypid() . '.tmp';
        if (@file_put_contents($tmp, $bytes, LOCK_EX) === CHUNK_SIZE) {
            @chmod($tmp, 0644);
            if (!@rename($tmp, $cacheFile)) {
                @unlink($tmp);   // 并发下 rename 失败是可接受的，另一个进程已写入
            }
        } else {
            @unlink($tmp);
        }
    }
}

if (is_file($cacheFile) && filesize($cacheFile) === CHUNK_SIZE && ($fh = @fopen($cacheFile, 'rb')) !== false) {
    // 首选路径：预生成文件循环输出
    for ($i = 0; $i < $chunks; $i++) {
        rewind($fh);
        fpassthru($fh);
        flush();
    }
    fclose($fh);
    exit;
}

// 兜底路径：磁盘不可写时退回内存输出（仅生成一次，不再逐请求生成）
$fallback = str_repeat(chr(0), CHUNK_SIZE);
if (function_exists('random_bytes')) {
    try {
        $fallback = random_bytes(CHUNK_SIZE);
    } catch (Exception $e) {
        $fallback = str_repeat(chr(0), CHUNK_SIZE);
    }
}
for ($i = 0; $i < $chunks; $i++) {
    echo $fallback;
    flush();
}