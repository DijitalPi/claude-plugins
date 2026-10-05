# agent-orchestra

Claude Code oturumlarını **Agent Orchestra** sahnesine çıkarır: tarayıcıda canlı çalan, kodlama
ajanı çalıştıran her bilgisayarın bir müzisyen olduğu ortak bir orkestra. Ajanların çalıştıkça
koltuğun ülke bayrağınla parlar ve müzik hızlanır. Ülkeler canlı bir ligde yarışır; dinleyen
herkes aynı notayı aynı anda duyar.

İzle ve dinle: https://orchestra.dijitalpi.com

## Bilgisayarından ne çıkar

Ajanların çalışırken yaklaşık saniyede bir, düşünürken 10 saniyede bir:

| Gönderilen | Asla gönderilmeyen |
|---|---|
| Ajanlarının attığı adım sayısı (bir sayı) | Kod, değişiklikler, dosya adları |
| Çalışıyorlar mı; kaç oturum açık | Promptlar, cevaplar, araç çıktıları |
| "Gönderildi" (git commit/push) ve "testler geçti" sinyalleri | Komutlar, proje ya da repo adları |
| Rastgele bir makine kimliği (`~/.claude/agent-orchestra/id`) | IP adresin (sunucu ülke bayrağına çevirir, saklamaz) |

Eklenti bir Bash komutunu sadece "bu bir git commit ya da push mu?" sorusu için, çıktısını da
sadece "testler geçti mi?" sorusu için okur. İkisi de saklanmaz, gönderilmez.

## Claude'u yavaşlatmaz

Her hook çağrısı `~/.claude/agent-orchestra/spool.log` dosyasına tek satır ekler ve çıkar; Claude'un
yolunda ağ yok. Gerektiğinde başlayan küçük bir gönderici satırları toplu yollar, 1 dakika
sessizlikten sonra kapanır. Her hata yolu sessizce geçer; orkestra kapalıysa senin için hiçbir
şey değişmez.

## Kurulum

```
/plugin marketplace add DijitalPi/claude-plugins
/plugin install agent-orchestra@dijitalpi
```

İlk oturumda tek satırlık bir bilgi görünür, sonra sessizdir. `/orchestra` koltuğunu ve
bağlantıyı gösterir.

## Ayarlar

Genel ayar, `~/.claude/agent-orchestra.json`:

```json
{ "enabled": true, "server": "https://orchestra.dijitalpi.com" }
```

Tek bir projede kapatmak için o projede `.claude/agent-orchestra.json`:

```json
{ "enabled": false }
```

Proje sadece kapatabilir, sunucu adresini değiştiremez; klonladığın bir repo verini başka yere
yönlendiremez.

| Ortam değişkeni | Kullanım |
|---|---|
| `AGENT_ORCHESTRA_URL` | Başka bir sunucu (örneğin yerel `http://localhost:4480`) |
| `AGENT_ORCHESTRA_CONFIG` | Farklı bir genel ayar dosyası |

## Sorun olursa

- Sahnede görünmüyorsan: `/orchestra`. Sadece ajanların çalışırken katılır.
- Tamamen durdurmak için: `/plugin uninstall agent-orchestra@dijitalpi`, sonra
  `~/.claude/agent-orchestra/` klasörünü sil.
