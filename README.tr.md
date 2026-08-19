# Claude Code için DijitalPi eklentileri

[![CI](https://github.com/DijitalPi/claude-plugins/actions/workflows/ci.yml/badge.svg)](https://github.com/DijitalPi/claude-plugins/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Claude Code plugins](https://img.shields.io/badge/Claude%20Code-marketplace-8A63D2)](https://claude.com/claude-code)

**Küçük, tek işe odaklı eklentiler. Her biri tek bir şey yapar, tek dosya olarak
gelir, bağımlılığı yoktur ve hata durumunda yoldan çekilir.**

🇬🇧 [English documentation →](README.md)

```bash
/plugin marketplace add DijitalPi/claude-plugins
```

Sonra istediğini kur:

```bash
/plugin install context-guard@dijitalpi
/plugin install install-guard@dijitalpi
/plugin install secret-guard@dijitalpi
/plugin install scope-guard@dijitalpi
/plugin install explain-simply@dijitalpi
```

Sonrasında Claude Code'u yeniden başlat. Buradaki her şey için `PATH`'inde
Node 14+ olması yeterli, başka hiçbir şey gerekmiyor.

---

## İçindekiler

### [context-guard](plugins/context-guard) — dolu pencereye yakalanma

Senin seçtiğin eşikte uyarır; toparlanmanın hâlâ sakin iki dakikalık bir iş
olduğu noktada, otomatik sıkıştırma altından olmadan önce. `saveCommand`'i
oturumu kaydetmek için ne kullanıyorsan ona bağla, uyarı dırdır olmaktan çıkıp
iş akışına dönüşsün. Opsiyonel statusline rozeti ve `/wrap-up` komutu var.

### [install-guard](plugins/install-guard) — paket gerçek mi diye bak

Modeller zaman zaman var olmayan paket adları uyduruyor, saldırganlar da en çok
uydurulanları önceden kaydediyor. Bu eklenti kurulum çalışmadan registry'ye
bakıyor: var olmayan adları engelliyor, çok yeni ya da neredeyse hiç indirilmemiş
paketleri soruyor, gerisinde susuyor. npm, pnpm, yarn, bun, pip, uv.

### [secret-guard](plugins/secret-guard) — anahtarları dosyadan uzak tut

Canlı kimlik bilgisi içeren yazmaları engeller: AWS anahtarları, GitHub
token'ları, sağlayıcı API anahtarları, PEM private key blokları. Bilinçli olarak
dar kapsamlı — genel `password = "..."` eşleştirmesi yok, çünkü boşuna alarm
veren koruma kapatılır. `.env` dosyalarına dokunmaz; anahtarın yeri orasıdır.

### [scope-guard](plugins/scope-guard) — doğru repo'ya yaz

Aynı anda birden fazla proje açıkken, birine ait düzenlemenin diğerine gitmesi
için. Sınır, çevreleyen git repo'su; dışına yazma iki yolu da göstererek onay
ister. Varsayılan sormak, istersen engeller.

### [explain-simply](https://github.com/DijitalPi/claude-explain-simply) — sade dille söyle

Uzun cevapların sonuna kısa, jargonsuz bir özet ekler — kodu yazmayanlar için.
Kendi repo'sunda duruyor, buradan kurulabiliyor.

---

## Hepsinin ortak şekli

Bilinçli olarak aynı kararlar:

- **Tek dosya, sıfır bağımlılık.** Sadece Node'un kendi modülleri. Kurulacak bir
  şey yok, güncel tutulacak bir şey yok, denetlenecek tek şey dosyanın kendisi.
- **Her zaman fail-open.** Bozuk config, internet yok, hatalı girdi, yazılamayan
  temp klasörü — her hata yolu sessizce çıkar ve işinin devam etmesine izin
  verir. Alakasız bir şey bozulduğunda seni engelleyen koruma öğlene kalmadan
  kaldırılır, sonra da hiçbir şeyi korumaz.
- **İzinleri asla genişletmez.** Bu araçlar susabilir, sorabilir ya da
  reddedebilir. Hiçbiri "izin ver" cevabı vermez — normalde göreceğin bir onay
  ekranını bastırmak bir güvenlik aracının yapacağı şey değil.
- **Proje bazında ayarlanabilir.** Proje kökündeki dosya `~/.claude`'dakini
  ezer; böylece bir repo kuralları kendisi için sıkabilir ya da gevşetebilir.
- **Varsayılan sessizlik.** Söyleyecek bir şeyi yoksa hiçbir şey söylemez ve
  token harcamaz.

---

## Testler

```bash
node --test test/*.test.js
```

Burada da kurulacak bir şey yok — eklentiler Node'un yerleşik modüllerini
kullanıyor, testler de Node'un yerleşik test runner'ını. Runner için Node 18+
gerekiyor; eklentilerin kendisi hâlâ Node 14+ ile çalışıyor.

Her koruma, Claude Code'un çalıştırdığı şekilde ayrı bir process olarak test
ediliyor: JSON girer, JSON ya da sessizlik çıkar. Her test kendi geçici `HOME` ve
`TMPDIR` klasörünü alıyor, yani testler senin ayarlarını değil kendi ayarlarını
okuyor; install-guard'ın registry cevapları da cache'e önceden yazıldığı için
testler internete hiç çıkmıyor.

Asıl garanti altına alınan üç şey: söyleyecek bir şeyi olmayan koruma susuyor,
hiçbiri "izin ver" cevabı vermiyor ve bozuk config ya da anlamsız girdide hepsi
yoldan çekiliyor. Bu repo'nun verdiği söz bunlar olduğu için test edilmeye değer
olanlar da bunlar.

---

## Katkı

Issue ve PR'lar açık. En işe yarayanlar sıkıcı olanlar: bir şeyi kapatmana neden
olan yanlış alarm, kapsanmayan bir paket ekosistemi, gözden kaçan bir kimlik
bilgisi formatı.

---

## Lisans

MIT — [LICENSE](LICENSE). Telif © 2026 DijitalPi.

**[DijitalPi](https://dijitalpi.com)** tarafından yazıldı — küçük ekipler için
yapay zekâ ve otomasyon araçları geliştiren tek kişilik stüdyo. Bu araçları önce
kendi işimiz için yazıyoruz; gerçek müşteri işinde ayakta kalanları açık kaynak
yapıyoruz.
