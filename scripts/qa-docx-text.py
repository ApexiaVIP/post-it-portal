#!/usr/bin/env python3
"""
Plain-text export of a Word document for the Call QA rulebook.

    python3 -I scripts/qa-docx-text.py <file.docx> [accept|reject] > out.txt

With tracked changes, "accept" gives the document as issued (changes taken)
and "reject" gives the version it was edited from (changes undone). That is
how the in-between versions of Guy's scripts are rebuilt from his marked-up
copies: the 4 Nov 2026 TRACKED files undone give the 21 Oct (One Call),
29 Oct (Fact Find) and 7 Oct (Fact Find sheet) versions.

Tables come out one row per line with cells separated by " | ", list items
start with "- ", and text boxes follow the paragraph they sit in.
"""
import sys
import zipfile
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def tag(el, name):
    return el.tag == W + name


class Exporter:
    def __init__(self, mode):
        self.mode = mode  # "accept" or "reject"
        self.lines = []
        self.carry = ""   # text of a paragraph whose mark was removed, joined to the next

    def dropped(self, el):
        """Whether a w:ins / w:del (or move) wrapper's content is left out in this mode."""
        if tag(el, "ins") or tag(el, "moveTo"):
            return self.mode == "reject"
        if tag(el, "del") or tag(el, "moveFrom"):
            return self.mode == "accept"
        return False

    def run_text(self, el, boxes):
        out = []
        for child in el:
            if tag(child, "t") or tag(child, "delText"):
                out.append(child.text or "")
            elif tag(child, "tab") or tag(child, "ptab"):
                out.append("\t")
            elif tag(child, "br") or tag(child, "cr"):
                out.append("\n")
            elif tag(child, "noBreakHyphen") or tag(child, "softHyphen"):
                out.append("-")
            elif tag(child, "sym"):
                out.append("☐")
            else:
                # Drawings and fallbacks can hold text boxes: collect them separately.
                for box in child.iter(W + "txbxContent"):
                    boxes.append(box)
        return "".join(out)

    def inline(self, el, boxes):
        """Text of a paragraph's content, honouring tracked changes."""
        out = []
        for child in el:
            if tag(child, "pPr"):
                continue
            if tag(child, "r"):
                out.append(self.run_text(child, boxes))
            elif tag(child, "ins") or tag(child, "del") or tag(child, "moveTo") or tag(child, "moveFrom"):
                if not self.dropped(child):
                    out.append(self.inline(child, boxes))
            elif tag(child, "hyperlink") or tag(child, "smartTag") or tag(child, "fldSimple") or tag(child, "customXml"):
                out.append(self.inline(child, boxes))
            elif tag(child, "sdt"):
                content = child.find(W + "sdtContent")
                if content is not None:
                    out.append(self.inline(content, boxes))
        return "".join(out)

    def mark_removed(self, p):
        """A paragraph mark that does not exist in this mode joins the paragraph to the next."""
        ppr = p.find(W + "pPr")
        rpr = ppr.find(W + "rPr") if ppr is not None else None
        if rpr is None:
            return False
        if self.mode == "reject" and rpr.find(W + "ins") is not None:
            return True
        if self.mode == "accept" and rpr.find(W + "del") is not None:
            return True
        return False

    def paragraph(self, p):
        boxes = []
        text = self.carry + self.inline(p, boxes)
        self.carry = ""
        if self.mark_removed(p):
            self.carry = text
        else:
            ppr = p.find(W + "pPr")
            if text.strip() and ppr is not None and ppr.find(W + "numPr") is not None:
                text = "- " + text.strip()
            self.lines.append(text.rstrip())
        for box in boxes:
            self.block(box)

    def cell_text(self, tc):
        sub = Exporter(self.mode)
        sub.block(tc)
        if sub.carry:
            sub.lines.append(sub.carry)
        return " / ".join(l.strip() for l in sub.lines if l.strip())

    def row_dropped(self, tr):
        trpr = tr.find(W + "trPr")
        if trpr is None:
            return False
        if self.mode == "reject" and trpr.find(W + "ins") is not None:
            return True
        if self.mode == "accept" and trpr.find(W + "del") is not None:
            return True
        return False

    def table(self, tbl):
        for tr in tbl.findall(W + "tr"):
            if self.row_dropped(tr):
                continue
            cells = [self.cell_text(tc) for tc in tr.findall(W + "tc")]
            # Merged cells repeat nothing; skip rows with no text at all.
            if any(cells):
                self.lines.append(" | ".join(c for c in cells if c))
        self.lines.append("")

    def block(self, container):
        for child in container:
            if tag(child, "p"):
                self.paragraph(child)
            elif tag(child, "tbl"):
                self.table(child)
            elif tag(child, "sdt"):
                content = child.find(W + "sdtContent")
                if content is not None:
                    self.block(content)
            elif tag(child, "ins") or tag(child, "del") or tag(child, "customXml"):
                if not self.dropped(child):
                    self.block(child)


def export(path, mode):
    root = ET.fromstring(zipfile.ZipFile(path).read("word/document.xml"))
    ex = Exporter(mode)
    ex.block(root.find(W + "body"))
    if ex.carry:
        ex.lines.append(ex.carry)
    text = "\n".join(ex.lines).replace(" ", " ")
    # Collapse runs of blank lines.
    out, blank = [], 0
    for line in text.split("\n"):
        blank = blank + 1 if not line.strip() else 0
        if blank <= 1:
            out.append(line)
    return "\n".join(out).strip() + "\n"


if __name__ == "__main__":
    if len(sys.argv) < 2 or (len(sys.argv) > 2 and sys.argv[2] not in ("accept", "reject")):
        sys.exit("usage: qa-docx-text.py <file.docx> [accept|reject]")
    sys.stdout.write(export(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "accept"))
