# scope-guard

**Üzerinde çalıştığın projenin dışına düşen yazmaları yakalar.**

Belirli ve sıkıcı bir hata için yazıldı: birden fazla terminal açık, her biri
farklı bir müşteri ya da servis, ve birine ait bir düzenleme diğerine gidiyor.
Hiçbir şey seni uyarmıyor, çünkü tek tek her eylem meşru. Sonra yanlış repo'nun
`git status`'unda öğreniyorsun.

---

## Sınırı nasıl belirliyor

Proje sınırı, varsa çevreleyen **git repo'su**, yoksa **çalışma dizini**. Bu
sınırın içindeki yazma sessiz geçer. Dışındaki, iki yolu da göstererek onay
sorar — ve hedef *başka bir* git repo'sunun içindeyse bunu açıkça söyler, çünkü
sessizce başkasının çalışma ağacını kirleten durum odur.

Her zaman izinli, çünkü oraya yazmak rutin: `~/.claude`, `/tmp`, `/private/tmp`,
`/var/folders`.

Göreli yollar çalışma dizinine göre çözüldüğü için doğaları gereği içeridedir,
hiç sorgulanmaz.

---

## Engelleme, sor

Varsayılan **sormak**, reddetmek değil. Projenin dışına yazmak çoğu zaman
doğrudur — global bir config, geçici bir dosya, gerçekten dokunmak istediğin
komşu bir repo. Mesele bunun kaza değil, karar olması.

Doğrudan reddetmesini istiyorsan:

```json
{ "outsideProject": "deny" }
```

---

## Kurulum

```bash
/plugin marketplace add DijitalPi/claude-plugins
/plugin install scope-guard@dijitalpi
```

**Gereksinim:** Node 14+. Bağımlılık yok, internet erişimi yok.

---

## Ayarlar

Global için `~/.claude/scope-guard.json`, proje için `.scope-guard.json`.

```json
{
  "enabled": true,
  "outsideProject": "ask",
  "allowPaths": ["~/.claude", "/tmp", "/private/tmp", "/var/folders"],
  "extraRoots": []
}
```

| Anahtar | Varsayılan | Ne yapar |
| --- | --- | --- |
| `enabled` | `true` | Kaldırmadan kapatır. |
| `outsideProject` | `"ask"` | `"ask"` sorar, `"deny"` reddeder, `"off"` eklenti kurulu kalırken kontrolü kapatır. |
| `allowPaths` | temp dizinleri + `~/.claude` | Her zaman sorunsuz sayılan yollar. `~` genişletilir. |
| `extraRoots` | `[]` | Bu projenin parçası sayılacak dizinler — birlikte çalıştığın komşu repo, ortak varlık klasörü. |

Bilerek iki repo üzerinde mi çalışıyorsun? İkincisini o proje için
`extraRoots`'a koy; sorular durur, kontrol başka hiçbir yerde zayıflamaz.

---

## Bir şey ters giderse

Fail-open: hatalı girdi, okunamayan config, çözülemeyen yol — yazma devam eder.
Kapatmak için `{ "enabled": false }`.

```bash
/plugin uninstall scope-guard@dijitalpi
```

---

MIT — [LICENSE](../../LICENSE). [DijitalPi](https://dijitalpi.com) tarafından yazıldı.
🇬🇧 [English](README.md)
