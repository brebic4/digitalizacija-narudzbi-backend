const orderExtractionPrompt = `
Analiziraj priloženi PDF dokument koji predstavlja narudžbu kupca.

Izdvoji sljedeće podatke:

- naziv kupca
- OIB kupca, ako postoji
- broj narudžbe
- datum isporuke
- napomenu, ako postoji
- sve stavke narudžbe

Za svaku stavku izdvoji:

- izvorni naziv proizvoda točno kako piše u dokumentu
- šifru proizvoda kupca
- barkod
- naručenu količinu

Pravila:

1. Nemoj izmišljati podatke.
2. Ako podatak nije vidljiv ili nisi siguran, vrati prazan string.
3. Količina mora biti cijeli broj. Ako nije pronađena, vrati 0.
4. Datum isporuke vrati u formatu YYYY-MM-DD.
5. Nemoj količinu zamijeniti težinom, cijenom ili brojem pakiranja.
6. Sačuvaj sve vodeće nule u šiframa i barkodovima.
7. Svaki red tablice mora odgovarati točno jednoj stavci.
8. Ne spajaj različite proizvode u jednu stavku.
9. Ne dodaj proizvode koji se ne nalaze u dokumentu.
10. Rezultat služi kao prijedlog koji će korisnik naknadno pregledati i potvrditi.
`;

export default orderExtractionPrompt;
