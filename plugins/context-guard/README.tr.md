# claude-context-guard

[![Release](https://img.shields.io/github/v/release/DijitalPi/claude-plugins?color=8A63D2)](https://github.com/DijitalPi/claude-plugins/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-8A63D2)](https://claude.com/claude-code)

**Context penceresi dolmadan önce, işini kaydedip temiz bir oturuma geçmeye vakit
varken seni uyaran Claude Code eklentisi.**

🇬🇧 [English documentation →](README.md)

Uzun oturumlar iki şekilde biter. Ya zamanında fark edersin, önemli olanı yazıp
temizlersin — ya da fark etmezsin, pencere dolar ve konuşma altından otomatik
sıkıştırılır. Sıkıştırma öngörülmesi zor bir şekilde kayıplıdır: genelde işin
iskeletini tutar, tam da birazdan lazım olacak detayı atar.

Bu eklenti pencereyi izler ve senin belirlediğin eşikte söz alır — toparlanmanın
hâlâ sakin iki dakikalık bir iş olduğu noktada.

---

## Nasıl görünüyor

Varsayılan %80'de, bir sonraki mesajında:

```
⚠️  Context 84% full — wrapping up (/kk will run), then clear the conversation.
```

Claude da aynı talimatı alır: mevcut isteği bitirir, kaydetmek için ne
söylediysen onu çalıştırır, ve sonunda açıkça "artık temizleyebilirsin" der.
Konuşmayı kendisi temizleyemez — sadece sen temizleyebilirsin — o yüzden o son
cümle önemli.

Eşiğin altında tamamen sessizdir.

---

## Kurulum

```bash
/plugin marketplace add DijitalPi/claude-plugins
/plugin install context-guard@dijitalpi
```

Sonra Claude Code'u yeniden başlat.

**Gereksinim:** `PATH`'inde Node 14 veya üstü. npm install yok, bağımlılık yok.

---

## `saveCommand` — asıl önemli ayar bu

Kutudan çıktığı hâliyle eklenti seni uyarır ve Claude'dan açık kalan işleri
özetlemesini ister. Bu da işe yarar, ama asıl değer onu senin zaten kullandığın
kaydetme komutuna bağlamakta:

```json
{ "saveCommand": "/kk" }
```

Artık eşiğe gelmek şu demek: bu isteği bitir → `/kk` çalıştır → kullanıcıya
temizlemesini söyle. Uyarı, dırdır olmaktan çıkıp bir iş akışına dönüşür.

Böyle bir komutun yoksa, bu eklentiyle gelen `/wrap-up` var (aşağıda) ve
`{ "saveCommand": "/wrap-up" }` makul bir başlangıç.

---

## `/wrap-up` komutu

Bazen ölçüm söylemeden sen zaten bittiğini bilirsin — günün sonu, ya da tamamen
alakasız bir işe geçmek üzeresin.

```
/wrap-up
/wrap-up staging şifrelerinin değiştiğini de not et
```

Mevcut işi temiz bir yerde durdurur, önemli olanı projenin zaten kullandığı yere
kaydeder, ve kısa bir devir notu basar: ne yapıldı, ne açık kaldı, sonraki oturum
neye ihtiyaç duyacak. Sonra temizlemenin güvenli olduğunu söyler.

Bilinçli olarak kendi kafasına göre bir not dosyası uydurmaz. Projede memory
dizini, `CLAUDE.md`, bariz bir yer yoksa bunu söyler ve özeti bir daha
bakmayacağın bir yere dosya bırakmak yerine ekrana basar.

---

## Pencereyi nasıl ölçüyor

Anlamaya değer, çünkü ayarını etkiliyor.

Claude Code hook'lara context'in ne kadar dolu olduğunu söylemiyor. *Statusline'a*
söylüyor. Bu yüzden iki yol var, eklenti hangisi varsa onu kullanıyor:

**1. Transcript tahmini (varsayılan, sıfır kurulum).** Transcript'teki her Claude
turu kendi token kullanımını kaydediyor; en sonuncusu pencerenin şu anki boyutu.
`contextLimit`'e bölünce yüzde çıkıyor.

⚠️ **`contextLimit` bu yüzden modelinle eşleşmeli.** Varsayılan `200000`. 1M
context'li bir modeldeysen ve varsayılanı bırakırsan, eklenti sen %20'deyken
%100'desin sanır ve sürekli uyarır. Ayarla:

```json
{ "contextLimit": 1000000 }
```

**2. Statusline yardımcısı (kesin, opsiyonel).** Claude Code statusline'a gerçek
`context_window.used_percentage` değerini veriyor. Pakette gelen yardımcı bu
sayıyı hook'un baktığı yere yazıyor — ve varsa hook onu kullanıp `contextLimit`'i
tamamen yok sayıyor. Tahmin yok, modele göre ayar yok.

Yardımcı senin statusline'ının **yerine geçmez**. Mevcut statusline'ının girdisini
içinden geçirirsin, rozeti istediğin yere koyarsın:

```bash
#!/bin/bash
input=$(cat)
plugin="$HOME/.claude/plugins/cache/dijitalpi/context-guard"
ctx=$(echo "$input" | node "$plugin"/*/statusline/context-percent.js --badge)

# ...mevcut statusline'ın, artı:
echo "$(senin_satirin) | $ctx"
```

`🟢 ctx 34%` / `🟡 ctx 67%` / `🔴 ctx 88%` basar. `--badge`'i kaldırırsan hiçbir
şey basmaz, sadece sayıyı hook için sessizce kaydeder.

---

## Ayarlar

İsteğe bağlı. Tüm projeler için `~/.claude/context-guard.json`, tek proje için
proje kökünde `.context-guard.json`. Proje ayarı üstün gelir.

| Anahtar | Varsayılan | Ne yapar |
| --- | --- | --- |
| `enabled` | `true` | `false` yaparsan kaldırmadan kapanır. |
| `threshold` | `80` | Uyarmaya başlayacağı yüzde. |
| `contextLimit` | `200000` | Modelinin pencere boyutu. **Sadece transcript tahmininde kullanılır** — statusline yardımcısı kuruluysa yok sayılır. |
| `saveCommand` | `""` | Claude'un oturumu kaydetmek için çalıştıracağı komut. Bunu uyarıdan iş akışına çeviren ayar. |
| `extraInstructions` | `""` | Uyarının sonuna aynen eklenir. Kendi akışın, kendi cümlelerin. |
| `showSystemMessage` | `true` | Tek satırlık uyarıyı sadece Claude'a değil, terminaline de bas. |
| `repeatEvery` | `1` | Eşiği geçtikten sonra kaç prompt'ta bir uyarsın. `0` = bir kez uyar, sonra sus. |

Örnek — 1M model, kaydetme komutu ve ekstra bir adım:

```json
{
  "threshold": 75,
  "contextLimit": 1000000,
  "saveCommand": "/kk",
  "extraInstructions": "Commit edilmemiş işi de mevcut branch'e push et.",
  "repeatEvery": 3
}
```

---

## Ne zaman kendini sıfırlar

Temizledikten (ya da Claude Code sıkıştırdıktan) sonra kullanım eşiğin altına
düşer ve eklenti kendini sıfırlar — tekrar yukarı tırmandığında bayat bir
hatırlatma değil, baştan tam uyarı alırsın. Elle sıfırlanacak bir şey yok.

---

## Maliyet

Uyarı ~120 token, ve sadece eşiğin üstündeyken. Altındayken hook hiçbir şey
yazmaz: sıfır token, sıfır context maliyeti. Kontrol işi modelin dışında oluyor.

---

## Bir şey ters giderse

Hook fail-open yazıldı. Bozuk config, okunamayan transcript, olmayan temp
klasörü, hatalı girdi — her yol çıktısız `0` ile biter. Prompt'unu engelleyemez,
oturumunu bozamaz. En kötü ihtimalle uyarılar sessizce gelmemeye başlar.

Kaldırmadan kapatmak için `"enabled": false`.

Kaldırmak için:

```bash
/plugin uninstall context-guard@dijitalpi
```

---

## Katkı

Issue ve PR'lar açık. Özellikle:

- Kullandığın modellerin context limitleri, varsayılanlar sana uymuyorsa.
- Uzun oturumlarda tahminin gerçek sayıdan saptığı durumlar.

---

## Lisans

MIT — [LICENSE](LICENSE). Telif © 2026 DijitalPi.

**[DijitalPi](https://dijitalpi.com)** tarafından yazıldı — küçük ekipler için yapay
zekâ ve otomasyon araçları geliştiren tek kişilik stüdyo. Bu araçları önce kendi
işimiz için yazıyoruz; gerçek müşteri işinde ayakta kalanları açık kaynak yapıyoruz.

Ayrıca: **[claude-explain-simply](https://github.com/DijitalPi/claude-explain-simply)** —
uzun Claude Code cevaplarının sonuna jargonsuz özet ekler.

🇬🇧 English: [README.md](README.md)
