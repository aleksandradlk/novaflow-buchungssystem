// Unit tests for reading customer lists (CSV/xlsx) and writing the export (CSV/ZIP).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { csvLesen, xlsxLesen, zeilenAufbereiten, zuordnungRaten } from '../../web/uebersicht/tabelle.js';
import { csvErstellen, zipErstellen } from '../../web/uebersicht/zip.js';

test('CSV: Semikolon, Anführungszeichen, Zeilenumbruch im Feld, BOM, leere Zeilen', () => {
  const z = csvLesen('﻿Vorname;Nachname;Notiz\r\nErika;"Muster; jun.";"zwei\nZeilen"\r\n\r\nPaul;"Sagt ""Hallo""";\r\n');
  assert.deepEqual(z, [['Vorname', 'Nachname', 'Notiz'], ['Erika', 'Muster; jun.', 'zwei\nZeilen'], ['Paul', 'Sagt "Hallo"', '']]);
});

test('CSV: Komma als Trenner wird erkannt', () => {
  assert.deepEqual(csvLesen('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('Excel (.xlsx): Texte, Zahlen, Datum, Lücken', async () => {
  const zip = new AdmZip();
  zip.addFile('xl/sharedStrings.xml', Buffer.from('<sst><si><t>Vorname</t></si><si><t>E-Mail</t></si><si><t>Newsletter</t></si><si><t>Einwilligung am</t></si><si><t>Jürgen &amp; Co</t></si></sst>'));
  zip.addFile('xl/styles.xml', Buffer.from('<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>'));
  zip.addFile('xl/worksheets/sheet1.xml', Buffer.from(
    '<worksheet><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" t="inlineStr"><is><t>j@example.com</t></is></c><c r="C2" t="b"><v>1</v></c><c r="D2" s="1"><v>45717</v></c></row>'
    + '<row r="3"><c r="A3" t="inlineStr"><is><t>Lücke</t></is></c><c r="D3"><v>12345</v></c></row>'
    + '</sheetData></worksheet>'));
  const z = await xlsxLesen(zip.toBuffer());
  assert.deepEqual(z, [
    ['Vorname', 'E-Mail', 'Newsletter', 'Einwilligung am'],
    ['Jürgen & Co', 'j@example.com', 'ja', '2025-03-01'],
    ['Lücke', '', '', '12345'],
  ]);
});

test('Zuordnung wird aus den Spaltenköpfen erraten; Einwilligung „x“/„ja“ = ja', () => {
  const kopf = ['E-Mail', 'Vorname', 'Name', 'Straße', 'PLZ', 'Stadt', 'Newsletter', 'Gerät / Modell'];
  const zuordnung = zuordnungRaten(kopf, [{ key: 'geraet', label: 'Gerät / Modell' }]);
  assert.deepEqual([zuordnung.email, zuordnung.vorname, zuordnung.nachname, zuordnung.strasse, zuordnung.plz, zuordnung.ort, zuordnung.einwilligung_email, zuordnung.zf_geraet], [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(zuordnung.telefon, -1);
  const zeilen = zeilenAufbereiten([['a@b.de', 'A', 'B', 'W 1', '12345', 'O', 'x', 'M1'], ['c@d.de', 'C', 'D', '', '', '', 'nein', '']], zuordnung, [{ key: 'geraet' }]);
  assert.deepEqual(zeilen[0], { nr: 2, anrede: '', vorname: 'A', nachname: 'B', email: 'a@b.de', telefon: '', strasse: 'W 1', plz: '12345', ort: 'O', zusatzfelder: { geraet: 'M1' }, einwilligung_email: true, einwilligung_datum: '' });
  assert.equal(zeilen[1].einwilligung_email, false);
});

test('Export: CSV mit Semikolon und BOM, ZIP lesbar mit Standard-Werkzeug', () => {
  const csv = csvErstellen([{ id: '1', name: 'A; B', json: { x: 1 }, collectionId: 'weg' }, { id: '2', extra: 'neu' }]);
  assert.equal(csv, '﻿id;name;json;extra\r\n1;"A; B";"{""x"":1}";\r\n2;;;neu\r\n');
  const zip = new AdmZip(Buffer.from(zipErstellen([{ name: 'kontakte.csv', daten: csv }, { name: 'fotos/x/bild.png', daten: new Uint8Array([1, 2, 3]) }])));
  assert.deepEqual(zip.getEntries().map((e) => e.entryName), ['kontakte.csv', 'fotos/x/bild.png']);
  assert.equal(zip.readAsText('kontakte.csv'), csv);
  assert.deepEqual([...zip.readFile('fotos/x/bild.png')], [1, 2, 3]);
});
