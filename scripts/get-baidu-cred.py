"""Extract current Baidu Netdisk credentials for open_folder_shortcut command."""
import json, os, shutil, sqlite3, sys, tempfile, urllib.request
from pathlib import Path

def get_cred():
    db = Path(os.environ["APPDATA"]) / "baidunetdisk" / "Network" / "Cookies"
    if not db.exists():
        sys.exit(1)
    tmp_dir = tempfile.mkdtemp(prefix="gongkao-cred-")
    try:
        copied = Path(tmp_dir) / "Cookies"
        shutil.copy2(str(db), str(copied))
        conn = sqlite3.connect(str(copied))
        rows = conn.execute(
            "SELECT name,value FROM cookies WHERE host_key LIKE '%baidu.com%' AND value<>''"
        ).fetchall()
        conn.close()
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    ck = {str(n): str(v) for n, v in rows}
    hdr = "; ".join(f"{k}={v}" for k, v in ck.items())
    req = urllib.request.Request(
        "https://pan.baidu.com/api/loginStatus?clienttype=0&web=1",
        headers={"Cookie": hdr, "User-Agent": "Mozilla/5.0", "Referer": "https://pan.baidu.com/"}
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        d = json.loads(r.read().decode("utf-8"))
    login = d.get("login_info", {})
    return {
        "uk": str(login.get("uk", "")),
        "user_name": login.get("username", ""),
    }

if __name__ == "__main__":
    try:
        cred = get_cred()
        print(json.dumps(cred, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)