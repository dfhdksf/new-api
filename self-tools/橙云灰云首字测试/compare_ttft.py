import getpass
import json
import statistics
import sys
import time
import urllib.request
import urllib.error
# 目前只能测试灰云,橙云测试会被cf拦截
# 参数：橙云 Base URL、直连 Base URL、模型、每个地址的测试次数
proxied, direct, model = sys.argv[1:4]
rounds = int(sys.argv[4]) if len(sys.argv) > 4 else 10
key = getpass.getpass("NewAPI Key: ")

endpoints = [("橙云", proxied), ("直连", direct)]
results = {"橙云": [], "直连": []}

for i in range(rounds):
    # 交替改变请求顺序，减小模型负载随时间变化带来的偏差
    order = endpoints if i % 2 == 0 else endpoints[::-1]
    for name, base_url in order:
        body = json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": "请只回复：你好"}],
            "stream": True,
            "max_tokens": 32,
        }).encode()

        request = urllib.request.Request(
            base_url.rstrip("/") + "/chat/completions",
            data=body,
            headers={
                "Authorization": "Bearer " + key,
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
                "Accept-Encoding": "identity",
            },
        )

        started = time.perf_counter()
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                headers_ms = (time.perf_counter() - started) * 1000
                if "text/event-stream" not in response.headers.get("Content-Type", ""):
                    raise ValueError("响应不是 SSE 流")

                first_event_ms = None
                first_text_ms = None
                data_lines = []

                for raw_line in response:
                    line = raw_line.decode("utf-8", errors="replace").rstrip("\r\n")
                    if line.startswith("data:"):
                        data_lines.append(line[5:].strip())
                    elif line == "" and data_lines:
                        elapsed_ms = (time.perf_counter() - started) * 1000
                        if first_event_ms is None:
                            first_event_ms = elapsed_ms

                        data = "\n".join(data_lines)
                        data_lines.clear()
                        if data == "[DONE]":
                            continue

                        event = json.loads(data)
                        for choice in event.get("choices", []):
                            if choice.get("delta", {}).get("content") and first_text_ms is None:
                                first_text_ms = elapsed_ms

                if first_text_ms is None:
                    raise ValueError("请求结束，但没有收到文本 delta.content")
                results[name].append(first_text_ms)
                print(
                    f"第{i + 1:02d}轮 {name}: "
                    f"响应头 {headers_ms:.0f}ms, "
                    f"首个事件 {first_event_ms:.0f}ms, "
                    f"首字 {first_text_ms:.0f}ms"
                )
        except urllib.error.HTTPError as exc:
            body = exc.read(1000).decode("utf-8", errors="replace")
            print(
                f"{name}: HTTP {exc.code}, "
                f"Server={exc.headers.get('Server')}, "
                f"CF-Ray={exc.headers.get('CF-Ray')}, "
                f"正文={body}"
            )
        except Exception as exc:
            print(f"第{i + 1:02d}轮 {name}: 失败: {exc}")

for name, _ in endpoints:
    values = results[name]
    if values:
        print(f"{name}: 成功 {len(values)}/{rounds} 次，首字中位数 {statistics.median(values):.0f}ms")




# python3 compare_ttft.py \
#   https://tokenn.site/v1 \
#   https://direct.tokenn.site/v1 \
#   gpt-6-astra \
#   10

# SSL_CERT_FILE=/etc/ssl/cert.pem python3 compare_ttft.py \
#   https://tokenn.site/v1 \
#   https://direct.tokenn.site/v1 \
#   gpt-6-astra \
#   10