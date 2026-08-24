import json, os, shutil, sqlite3, sys, tempfile, urllib.request, urllib.parse
from pathlib import Path

def load_cookie_and_uk():
    cookie_db = Path(os.environ["APPDATA"]) / "baidunetdisk" / "Network" / "Cookies"
    if not cookie_db.exists():
        raise RuntimeError("Cookie DB not found")
    with tempfile.TemporaryDirectory(prefix="gongkao-cred-") as tmp:
        copied = Path(tmp) / "Cookies"
        shutil.copy2(cookie_db, copied)
        conn = sqlite3.connect(str(copied))
        try:
            rows = conn.execute("SELECT name, value FROM cookies WHERE host_key LIKE '%baidu.com' AND value <> ''").fetchall()
        finally:
            conn.close()
    cookies = {str(n): str(v) for n, v in rows if n and v}
    bduss = cookies.get("BDUSS", "")
    if not bduss:
        raise RuntimeError("BDUSS not found")
    cookie_header = "; ".join(f"{n}={v}" for n, v in cookies.items())
    
    # Try listing root directory to extract UK from response
    query = urllib.parse.urlencode({"dir": "/", "num": 1, "page": 1, "order": "name", "desc": 0, "web": 1})
    req = urllib.request.Request(
        f"https://pan.baidu.com/api/list?{query}",
        headers={"Cookie": cookie_header, "User-Agent": "Mozilla/5.0 GongkaoManager/1.0", "Referer": "https://pan.baidu.com/disk/main"}
    )
    uk = ""
    username = ""
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if data.get("errno") not in (0, None):
            raise RuntimeError(f"List API error: {data.get('errno')}")
        uk = str(data.get("uk", data.get("login_uk", "")))
        guidance = data.get("guidance") or data.get("guidance_info") or {}
        username = str(data.get("user_name", guidance.get("user_name", "")) or "")
    except Exception as e:
        # Fallback: try user info API
        try:
            req2 = urllib.request.Request(
                "https://pan.baidu.com/rest/2.0/membership/user?method=query",
                headers={"Cookie": cookie_header, "User-Agent": "Mozilla/5.0", "Referer": "https://pan.baidu.com/"}
            )
            with urllib.request.urlopen(req2, timeout=15) as resp2:
                d2 = json.loads(resp2.read().decode("utf-8"))
            uk = str(d2.get("uk", d2.get("user_info", {}).get("uk", "")))
        except:
            pass
    
    return {"uk": uk, "bduss_prefix": bduss[:12] + "..."}

if __name__ == "__main__":
    try:
        info = load_cookie_and_uk()
        print(json.dumps(info, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)