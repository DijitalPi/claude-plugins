# install-guard

**Paketleri kurulmadan önce kendi registry'sinde kontrol eder.**

Yapay zekâ modelleri zaman zaman var olmayan paket adları uyduruyor. Ad kulağa
doğru geliyor, kurulum komutu sıradan görünüyor, ama paket yok. Bu yeterince sık
oluyor ki saldırganlar modellerin en çok uydurduğu isimleri takip edip önceden
kaydediyor ve bekliyor — sen gerçek bir registry'den gerçek bir paket alıyorsun,
içinde ne koydularsa o.

Çözüm: komut çalışmadan önce tek bir sorgu.

---

## Ne yapar

| Durum | Ne olur |
| --- | --- |
| Paket registry'de yok | **Engellenir.** Kaybedilen bir şey yok — ad ya yazım hatası ya uydurma. |
| Paket var ama çok yeni, ya da neredeyse hiç indirilmemiş | **Sana sorulur**, sayılarla birlikte. Yeni paket kötü demek değil, sadece sorunların başladığı yer. |
| Diğer her şey | **Sessizlik.** Normal izin akışı olduğu gibi devam eder. |

Asla "izin ver" demez. İzinleri genişletmek bir koruma aracının işi değil — en
fazla yoldan çekilir.

`npm` / `pnpm` / `yarn` / `bun` ve `pip` / `uv pip` destekleniyor. Git URL'leri,
yerel yollar ve lockfile kuran düz `npm install` / `npm ci` atlanıyor — ortada
kontrol edilecek bir registry adı yok.

---

## Kurulum

```bash
/plugin marketplace add DijitalPi/claude-plugins
/plugin install install-guard@dijitalpi
```

**Gereksinim:** Node 14+. Bağımlılık yok. `registry.npmjs.org`, `api.npmjs.org`
ve `pypi.org` erişimi gerekiyor — erişemediğinde işini engellemek yerine yoldan
çekiliyor.

---

## Ayarlar

Global için `~/.claude/install-guard.json`, proje için `.install-guard.json`.

```json
{
  "enabled": true,
  "minAgeDays": 90,
  "minWeeklyDownloads": 1000,
  "blockUnknown": true,
  "timeoutMs": 3000,
  "allowlist": []
}
```

| Anahtar | Varsayılan | Ne yapar |
| --- | --- | --- |
| `enabled` | `true` | Kaldırmadan kapatır. |
| `minAgeDays` | `90` | Bundan daha yeni yayınlanmış paketleri sorar. |
| `minWeeklyDownloads` | `1000` | Haftalık indirmesi bunun altındaki npm paketlerini sorar. PyPI indirme sayısı yayınlamıyor, bu yüzden sadece npm. |
| `blockUnknown` | `true` | Registry'nin hiç duymadığı paketleri engeller. Kapatırsan eklenti sadece tavsiye veren bir şeye dönüşür. |
| `timeoutMs` | `3000` | İstek başına zaman aşımı. Aşılırsa kontrol atlanır, hata verilmez. |
| `allowlist` | `[]` | Hiç sorgulanmayacak isimler — şirket içi paketler, özel registry'ler. |

Özel bir registry'nin arkasındaysan ya da çok sayıda şirket içi paketin varsa
`allowlist` emniyet valfi; `blockUnknown: false` daha büyük balyoz.

---

## Bilinmesi gereken iki şey

**Yaş kontrolü devasa paketlerde "elinden geleni yapar".** Yayın tarihi sadece
npm'in tam paket dokümanında var; `react` gibi bir şey için bu, megabaytlarca
sürüm geçmişi demek ve bir hook'un zaman aşımı içinde inmez. Bu yüzden haftalık
100 binden fazla indirilen paketlerde yaş kontrolü atlanıyor — ki bu doğru: yüz
milyon indirmesi olan bir pakete "acaba çok mu yeni" diye sormanın anlamı yok.
Varlık ve indirme sayısı her zaman küçük ve hızlı uçlardan kontrol ediliyor.

**Sonuçlar 24 saat önbelleğe alınıyor**, böylece arka arkaya kurulumlar arka
arkaya ağ isteğine dönüşmüyor.

---

## Bir şey ters giderse

Her yolda fail-open: internet yok, registry çökmüş, zaman aşımı, bozuk config,
ayrıştırılamayan komut — kurulum devam eder. Ağ takıldığında işini engelleyen bir
koruma aracı öğlene kalmadan kaldırılır.

Kapatmak için `{ "enabled": false }`. Kaldırmak için:

```bash
/plugin uninstall install-guard@dijitalpi
```

---

MIT — [LICENSE](../../LICENSE). [DijitalPi](https://dijitalpi.com) tarafından yazıldı.
🇬🇧 [English](README.md)
