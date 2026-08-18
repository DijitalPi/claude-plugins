# secret-guard

**Canlı bir kimlik bilgisinin dosyaya yazılmasını engeller.**

Engellediği hata sıradan: bir şeyin çalışması için anahtar bir config dosyasına
yapıştırılır, dosya commit edilir, ve anahtar artık herkese açıktır. Anahtarı
değiştirmek işin kolay kısmı — fark etmek zor olanı.

---

## Neyi yakalar

AWS access key ID'leri, GitHub token'ları (klasik ve fine-grained), Anthropic ve
OpenAI anahtarları, Google API anahtarları, Slack token'ları ve webhook'ları,
Stripe canlı anahtarları, SendGrid anahtarları, npm token'ları ve PEM private key
blokları.

`Write`, `Edit` ve `NotebookEdit` üzerinde çalışır. Eşleşme yazmayı engeller ve
ne bulduğunu açıklar — anahtarın sadece ilk birkaç karakterini gösterir, tamamını
asla.

---

## Bilinçli olarak neyi yakalamaz

**Genel `password = "..."` kalıpları.** Bunlar test verilerinde, dokümanlarda,
yorumdaki "password" kelimesinde tetiklenir. Boşuna alarm veren bir koruma aracı
kapatılır, kapatılmış koruma da hiçbir şeyi korumaz. Buradaki her desenin, düz
metnin kazara üretmeyeceği belirgin bir şekli var.

**`.env` dosyalarındaki hiçbir şey.** Anahtarın yaşaması *gereken* yer orası.
Eklenti `.env`, `.env.local`, `.env.production` ve benzerlerine dokunmaz.

**Bariz placeholder'lar.** İçinde `your-api-key`, `example`, `replace-me`,
`xxxx`, `<...>`, `${...}` geçen bir satır sızıntı değil, doküman sayılır. Tek
istisna PEM private key bloğu — o hiçbir zaman tamamı yapıştırılmaya değer bir
örnek değildir.

---

## Kurulum

```bash
/plugin marketplace add DijitalPi/claude-plugins
/plugin install secret-guard@dijitalpi
```

**Gereksinim:** Node 14+. Bağımlılık yok, internet erişimi yok — her şey yerel
desen eşleştirme, dosyalarınla ilgili hiçbir şey makineden çıkmıyor.

---

## Ayarlar

Global için `~/.claude/secret-guard.json`, proje için `.secret-guard.json`.

```json
{
  "enabled": true,
  "allowFiles": [".env", ".env.local", ".env.production"],
  "extraPatterns": [],
  "disablePatterns": []
}
```

| Anahtar | Varsayılan | Ne yapar |
| --- | --- | --- |
| `enabled` | `true` | Kaldırmadan kapatır. |
| `allowFiles` | `.env` ailesi | Kimlik bilgisi içermesine izin verilen dosya adları. Dosya adı üzerinden eşleşir, yani `.env.staging` de `.env` girdisiyle çalışır. |
| `extraPatterns` | `[]` | Sana özel formatlar için ek regex — şirket içi token öneki, bir sağlayıcının anahtar şekli. |
| `disablePatterns` | `[]` | Kapatılacak desen adları, örn. `["openai-key"]` — biri senin kod tabanında gürültü yapıyorsa. |

`disablePatterns` için desen adları: `aws-access-key-id`, `github-token`,
`github-pat-fine`, `anthropic-key`, `openai-key`, `google-api-key`,
`slack-token`, `stripe-live-key`, `sendgrid-key`, `npm-token`, `private-key`,
`slack-webhook`.

---

## Engellememesi gerekeni engellerse

Hangi desenin tetiklendiğini söyler. Üç çıkış yolu, tercih sırasına göre:
placeholder'ı bariz şekilde sahte yap, değeri `.env` dosyasına taşı, ya da o
proje için desen adını `disablePatterns`'a ekle.

Hatada fail-open — bozuk config, hatalı girdi, okunamayan her ne olursa: yazma
devam eder. Tamamen kapatmak için `{ "enabled": false }`.

```bash
/plugin uninstall secret-guard@dijitalpi
```

---

MIT — [LICENSE](../../LICENSE). [DijitalPi](https://dijitalpi.com) tarafından yazıldı.
🇬🇧 [English](README.md)
