# Skills — Open Design (ditambahkan dari nexu-io/open-design)

Folder ini berisi **162 skill fungsional** yang disalin dari
[`nexu-io/open-design`](https://github.com/nexu-io/open-design) (folder `skills/`)
pada 15 Agustus 2026, mengikuti konvensi Agent Skills (`SKILL.md` + `assets/` /
`references/`). Dua skill lainnya di folder ini (`my-ai-enginering`,
`skill-project-guardian`) adalah bawaan proyek.

Skill dari open-design mencakup pembuatan desain/artefak (prototipe, deck,
dashboard, kartu sosial media), ekstraksi brand, brainstorming, hingga utilitas
rendering — mis. `artifacts-builder`, `brand-extract`, `brainstorming`,
`card-twitter`, `article-magazine`, `hyperframes-*`, `guizang-*`, dll.

## Lisensi
Skill dari open-design berlisensi **Apache-2.0** (kecuali skill yang membawa
`LICENSE` sendiri di foldernya, seperti `brandkit` dan `brutalist-skill`).

# Skills — Ponytail (ditambahkan dari DietrichGebert/ponytail)

Enam skill dari [`DietrichGebert/ponytail`](https://github.com/dietrichgebert/ponytail)
juga disalin ke folder ini (15 Agustus 2026): **`ponytail`** (mode kode minimal:
YAGNI → reuse → stdlib → fitur native → dependency → satu baris → minimum yang
berfungsi, dengan level lite/full/ultra), **`ponytail-review`** (review diff untuk
over-engineering), **`ponytail-audit`** (audit seluruh repo), **`ponytail-debt`**
(ledger shortcut yang ditunda), **`ponytail-gain`** (scoreboard dampak), dan
**`ponytail-help`** (referensi cepat).

Repo sumber menyediakan lebih banyak lagi: aturan selalu-aktif (`AGENTS.md`,
`.agents/rules/ponytail.md`), lifecycle hooks untuk Claude Code/Codex
(`hooks/`), dan adaptor untuk banyak agent lain — tidak disalin karena bersifat
plugin-tier dan bergantung pada runtime/konfigurasi host tertentu.

Lisensi: MIT (lihat `LICENSE` di repo sumber).

## Cara memperbarui
```bash
# Ambil daftar file terbaru lalu unduh lagi dengan pola yang sama:
# https://raw.githubusercontent.com/nexu-io/open-design/main/skills/<path>
```
Catatan: `skills/AGENTS.md` dan `skills/README.md` milik repo sumber sengaja
tidak disalin karena berisi ketentuan khusus daemon open-design.
