# Beveiliging

Welkom Terug draait op een tablet die door veel verschillende gasten wordt aangeraakt. Daarom zijn er maatregelen tegen meekijken, raden en misbruik.

## Maatregelen

| Risico | Maatregel |
| --- | --- |
| Pincode wordt buitgemaakt uit de opslag | Pincodes worden niet opgeslagen. Alleen een PBKDF2-SHA-256-hash met een willekeurige salt van 16 bytes per profiel en 150.000 rondes. |
| Pincode raden | Na 5 foute pogingen gaat het profiel 15 minuten op slot. Het beheerscherm ook. Zwakke pincodes zoals 1111 en 1234 worden geweigerd. |
| Uitzoeken welke namen bestaan | Bij een fout volgt altijd dezelfde melding, of de naam nu bestaat of niet. |
| Timing-aanvallen op de vergelijking | Hashes worden in constante tijd vergeleken. |
| Volgende gast ziet gegevens van de vorige | Na 90 seconden zonder aanraking terug naar het begin. Het beginscherm wist alle velden. Het beheerscherm sluit na 5 minuten. |
| Kwaadaardige invoer (XSS) | Invoer wordt altijd als tekst weergegeven (`textContent`), nooit als HTML. Velden hebben een maximale lengte en stuurtekens worden verwijderd. |
| Code van buitenaf | Strikte Content Security Policy: alleen eigen scripts en stijlen, `connect-src 'none'`, geen inline code. |
| Clickjacking | De app weigert te draaien in een frame van een andere site. |
| Te veel gegevens bewaren | Alleen voornaam, wensen en de laatste 30 bestellingen. Automatisch verwijderen na de bewaartermijn. Afgehandelde bestellingen verdwijnen na 24 uur. |

## Bekende beperkingen van deze demo

- **Opslag op het apparaat:** de gegevens staan in `localStorage` van de tablet, onversleuteld (de pincodes uitgezonderd). Wie fysiek toegang heeft tot de tablet en de ontwikkelhulpmiddelen van de browser, kan voornamen en bestellingen zien. In een productieversie horen de gegevens versleuteld op een server te staan en draait de tablet in kioskmodus.
- **Pincode van 4 cijfers:** er zijn maar 10.000 combinaties. De lockout maakt raden via het scherm onpraktisch, maar wie de opgeslagen hashes kopieert, kan ze offline proberen. Daarom bevat een profiel geen gevoelige gegevens. Een productieversie moet de hashes op een server bewaren.
- **Lockout per apparaat:** wie de opslag van de browser wist, wist ook de lockout. Ook dit lost een backend op.
- **GitHub Pages** laat geen eigen HTTP-headers toe. De CSP staat daarom in een `<meta>`-tag.

## Een kwetsbaarheid melden

Meld beveiligingsproblemen via een [privé security-advies op GitHub](https://github.com/freed-cloud/welkom-terug/security/advisories/new), niet in een openbaar issue.
