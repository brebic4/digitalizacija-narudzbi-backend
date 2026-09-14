# DIGITALIZACIJA PROCESA NARUČIVANJA ZA PROIZVODNO PODUZEĆE SUHOMESNATIH PROIZVODA - BACKEND

**Završni rad**

**Autor:** Bruno Rebić

**Mentor:** izv. prof. dr. sc. Nikola Tanković

Sveučilište Jurja Dobrile u Puli, Fakultet informatike

## Sažetak

Ovaj završni rad opisuje razvoj web-aplikacije za digitalizaciju procesa zaprimanja, obrade i praćenja narudžbi u proizvodnom poduzeću suhomesnatih proizvoda. Razvoj aplikacije potaknut je potrebom za zamjenom postojećeg načina rada koji uključuje ručnu obradu PDF narudžbi, prepisivanje podataka i komunikaciju između zaposlenika putem različitih kanala.

Razvijena web-aplikacija omogućuje autentikaciju korisnika, upravljanje kupcima, proizvodima, narudžbama i zaposlenicima te pregled ključnih poslovnih pokazatelja. Poseban dio sustava predstavlja primjena umjetne inteligencije kroz automatiziranu obradu PDF narudžbi i poslovni AI chatbot.

Backend aplikacije razvijen je u Node.js okruženju korištenjem Express.js okvira i MongoDB baze podataka. Backend implementira poslovnu logiku sustava, autentikaciju i autorizaciju korisnika, upravljanje poslovnim podacima i narudžbama te integraciju s OpenAI API-jem za obradu PDF dokumenata i rad poslovnog AI chatbota.

## Funkcionalnosti

- Autentikacija korisnika pomoću JWT pristupnih tokena
- Autorizacija prema korisničkim ulogama administratora i zaposlenika
- Upravljanje korisnicima i zaposlenicima
- Upravljanje kupcima
- Upravljanje proizvodima
- Upravljanje narudžbama
- Promjena statusa narudžbi i evidentiranje povijesti promjena
- Validacija podataka i provođenje poslovnih pravila
- Hashiranje korisničkih lozinki pomoću bcrypt biblioteke
- Pohrana poslovnih podataka u MongoDB bazu podataka
- Izračun poslovnih pokazatelja za nadzornu ploču
- Učitavanje i obrada PDF narudžbi
- AI analiza PDF dokumenata korištenjem OpenAI API-ja
- Automatsko izdvajanje podataka o kupcu, broju narudžbe, datumu isporuke, proizvodima i količinama
- Povezivanje izdvojenih podataka s postojećim kupcima i proizvodima u bazi podataka
- Poslovni AI chatbot povezan s podacima pohranjenima u sustavu
- Kontrolirani read-only pristup poslovnim podacima putem alata dostupnih AI chatbotu

## Korištene tehnologije

- Node.js
- Express.js
- MongoDB
- JSON Web Token (JWT)
- bcrypt
- OpenAI API
- JavaScript

## Demo računi

### Zaposlenik

**Korisničko ime:** `ivan.horvat@poduzece.hr`  
**Lozinka:** `IvanHorvat123`

### Administrator

**Korisničko ime:** `admin@poduzece.hr`  
**Lozinka:** `Admin123!`

## Backend

https://digitalizacija-narudzbi-backend.onrender.com

## Frontend repozitorij

https://github.com/brebic4/digitalizacija-narudzbi-frontend

## Web aplikacija

https://digitalizacija-narudzbi-frontend.vercel.app

## Dokumentacija

[Završni rad - Digitalizacija procesa naručivanja za proizvodno poduzeće suhomesnatih proizvoda](https://github.com/brebic4/digitalizacija-narudzbi-frontend/blob/main/Zavr%C5%A1ni%20rad%20-%20dokumentacija.pdf)
