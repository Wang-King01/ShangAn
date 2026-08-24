import re
path = r"C:\Users\汪蒋涛\Documents\Codex\2026-07-09\xia\gongkao-manager\public\app.js"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

old = r'          " \u00b7 \u7b14\u8bd5\uff1a" + esc(exam.writtenDate || "\u5f85\u516c\u5e03") + "</p><p>" + esc(exam.distribution || "\u9898\u578b\u5206\u5e03\u5f85\u8865\u5145") + "</p></article>";'

if old in content:
    new = '          " \u00b7 \u7b14\u8bd5\uff1a" + esc(exam.writtenDate || "\u5f85\u516c\u5e03") + "</p><p>" + esc(exam.distribution || "\u9898\u578b\u5206\u5e03\u5f85\u8865\u5145") + "</p>" + (exam.noticeUrl ? \'<a class="exam-notice-link" href="\' + safeUrl(exam.noticeUrl) + \'" target="_blank" rel="noopener" title="\u67e5\u770b\u5b98\u65b9\u901a\u77e5">\' + icon("file-text") + esc(exam.noticeLabel || "\u5b98\u65b9\u901a\u77e5") + "</a>" : "") + "</article>";'
    content = content.replace(old, new)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print("renderExams card updated OK")
else:
    print("NOT FOUND - searching for context...")
    idx = content.find('\u9898\u578b\u5206\u5e03\u5f85\u8865\u5145')
    if idx > 0:
        snippet = content[idx-200:idx+200]
        for i, ch in enumerate(snippet):
            if ord(ch) >= 128:
                snippet = snippet[:i] + '\\u{:04x}'.format(ord(ch)) + snippet[i+1:]
        print("Snippet:", repr(snippet))
