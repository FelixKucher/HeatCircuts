# HeatCircuits

Heizkreise für Flächenheizungen auf einer geladenen Zeichnung planen – in der Art von LoopCAD, auf Europa ausgerichtet, metrisch und in °C. Die Zeichnung des Architekten (PDF, DXF, Bild oder IFC) wird maßstäblich hinterlegt. Darauf zeichnet man die beheizten Räume nach, setzt die Verteiler und lässt die Loops verlegen und abgleichen. Am Ende steht ein druckfertiger Auslegungsbericht in DIN A4.

Die Berechnung folgt diesen Normen:

- **Heizlast** in Anlehnung an **EN 12831-1 / DIN/TS 12831-1**;
- **Erdreich** nach **EN ISO 13370**, **U-Werte** nach **EN ISO 6946**;
- **Flächenheizung** nach **EN 1264-2/-3/-5**.

Die App läuft vollständig im Browser, ohne Server und ohne Konto. Das frühere Haus-CAD (Möbel, Treppen, 3D-Ansicht) liegt im Branch `archiv/hauscad-komplett`.

## Ablauf

**Projekt › Neues Projekt** startet den Assistenten:

1. **Gebäude:** Gebäudeart (angebaute Seiten werden zu Trennwänden), Baujahr mit Vorbelegung der Aufbauten, Fenster, Keller, oberer Abschluss, Geschosse.
2. **Standort:** Klick auf die Karte und Höhe über NN. Norm-Außentemperatur und Jahresmittel werden aus den vier nächsten Klimastationen interpoliert und mit 0,5 K je 100 m auf die Höhe umgerechnet.
3. **Heizung:** Wärmeerzeuger (Ziel-Vorlauf als Richtwert), Fußbodensystem, zulässige Verlegeabstände.
4. **Zeichnung:** PDF, DXF, Bild oder IFC laden, ohne Vorlage beginnen oder das Beispiel öffnen.

Danach führen fünf **Arbeitsphasen** durch das Projekt (Leiste oben, ⇧1 – ⇧5):

| Phase | Inhalt |
| --- | --- |
| 1 Plan | Zeichnung laden und Maßstab prüfen (K), beheizte Räume nachzeichnen (Rechteck R, Polygon P, Doppelklick erkennt umschlossene Räume, Erkennung aus dem Bild), Aussparungen (U) für Treppenloch, Einbauten, Kücheninsel; Außenwände (W) und Fenster (O) für die Heizlast |
| 2 Heizlast | Raumart, Temperatur, Luftwechsel, Boden- und Deckenbegrenzung; Wandart und Aufbau, U-Wert je Fenster und Tür |
| 3 Heizflächen | je Raum Fußboden-, Wand- und Deckenheizung (Nass, Fräs, Trocken, Elektro, Putz, Trockenbau), Wandansicht, Bilanz Heizlast ↔ Leistung |
| 4 Heizkreise | Verteiler und Wärmeerzeuger setzen, automatische Verteilung mit gleichen Kreislängen, Anbindeleitungen von Hand, Anschlusspunkte, hydraulischer Abgleich |
| 5 Bericht | Tabellen (Räume, Heizflächen, Kreise, Verteiler, Material), Auslegungsbericht DIN A4, CSV |

**Format übertragen** (Y) kopiert Eigenschaften von einem Raum, einer Wand oder Öffnung auf weitere.

## Vorlagen und Import

| Quelle | Ergebnis |
| --- | --- |
| **PDF** | Seite wählen (Vorschaubilder), Planmaßstab wird aus dem Schriftfeld erkannt („M 1:100“), sonst wählbar oder per Zweipunkt-Kalibrierung; die Seite wird mit 5000 px gerastert und maßstäblich hinterlegt. pdf.js (Apache-2.0), Legacy-Build für Safari/WebKit. |
| **DXF** | maßstäbliche Vektorvorlage (LINE, LWPOLYLINE, POLYLINE, ARC, CIRCLE, TEXT, INSERT; Einheit aus `$INSUNITS`). DWG vorher nach DXF wandeln, z. B. mit dem ODA File Converter. |
| **Bild** | PNG, JPG, WebP, GIF, SVG mit Kalibrierung und Raumerkennung |
| **IFC (BIM)** | Geschosse aus `IfcBuildingStorey`, Räume aus `IfcSpace` (Umriss der Körperunterseite, Raumart aus dem Namen), Wände als Achse und Dicke, Fenster und Türen mit Breite, Höhe und Brüstung. web-ifc (MPL-2.0), wird erst beim Import geladen. Geprüft mit dem FZK-Haus (KIT). |

## Austausch

| Format | Richtung |
| --- | --- |
| Projektdatei `.heatcircuits.json` | Öffnen und Speichern, Autosave im Browser (IndexedDB) |
| SVG | Plan des Geschosses mit Heizkreisen, mit oder ohne Vorlage |
| DXF | schreiben als DXF R12 in Metern mit Layern |
| CSV | Ergebnistabellen (Semikolon, Dezimalkomma) |
| Auslegungsbericht DIN A4 | druckfertiges HTML (`@page A4`), Drucken als PDF oder Speichern: Kennwerte, Klima, U-Werte, Heizlast je Raum, Temperaturen und Oberflächentemperaturen, Heizkreise mit Einstellwert V̇ (l/min) und Drosselung, Verteiler, Material, Pläne je Geschoss, Normwerte |

## Normwerte und Annahmen

Schwer zu beschaffende Werte sind mit dem europäischen Standard bzw. der gängigen Herstellerpraxis vorbelegt und bleiben änderbar. Jeder Wert trägt Quelle und Status (Norm, Norm national, Praxiswert, Annahme) – sichtbar unter „Auslegung“ und im Bericht. „EU-Normwerte setzen“ stellt die Auslegung zurück.

| Größe | Vorgabe | Status |
| --- | --- | --- |
| max. Druckverlust je Heizkreis inkl. Anbindung | 250 mbar | Praxiswert (z. B. Uponor); EN 1264 legt keinen Wert fest |
| max. Kreislänge | je Rohr, 16 × 2: 100 m | Praxiswert |
| Spreizung im Auslegungsraum | σ ≤ 5 K | EN 1264-3 |
| Oberflächentemperatur Fußboden | 29 / 33 (Bad) / 35 °C (Randzone) | EN 1264-2/-3 |
| Rohrüberdeckung Zementestrich | 45 mm | DIN 18560-2 |
| Mindestluftwechsel Wohnräume / Küche, Bad | 0,5 / 1,5 1/h | EN 12831-1 Anhang B / Annahme |
| Temperatur beheizter Nachbarn, b_u unbeheizter Räume | 15 °C, 0,3–0,9 | Annahme (national festzulegen) |

## Tastenkürzel

| Taste | Funktion |
| --- | --- |
| ⇧1 – ⇧5 | Arbeitsphase |
| V / H | Auswählen / Ansicht verschieben (auch Leertaste, mittlere Maustaste) |
| K | Maßstab der Zeichnung |
| R / P / U | Raum aufziehen / Raumpolygon / Aussparung |
| W / O | Wand nachzeichnen (Länge tippen + Enter) / Tür oder Fenster |
| D / X | Bemaßung / Text |
| M / G / L | Verteiler / Wärmeerzeuger / Anbindeleitung |
| Y / Q | Format übertragen / Auswahl um 90° drehen |
| Bild ↑ / Bild ↓ | Geschoss wechseln |
| ⌘/Strg Z, ⇧Z, C, V, X, D, A, S, O, N | Rückgängig, Wiederholen, Kopieren, Einfügen, Ausschneiden, Duplizieren, Alles, Speichern, Öffnen, Neu |

## Rechenverfahren

### Heizlast (vereinfacht nach EN 12831-1)

- **Transmission:** Φ_T = Σ A·(U + ΔU_WB)·b·(θ_int − θ_e). U je Bauteil aus dessen eigenem Aufbau, sonst aus dem Gebäudeaufbau; U je Fenster und Tür.
- **Haus- und Wohnungstrennwände, Nachbarwohnungen:** A·U·(θ_int − θ_Nachbar) mit einer angenommenen Nachbartemperatur (Vorgabe 15 °C). Diese Annahme ist zu prüfen; maßgeblich ist der nationale Anhang.
  - Fenster- und Türflächen ergeben sich aus den gezeichneten Öffnungen.
  - Außenwandlängen werden entlang der Raumkontur ermittelt.
- **Erdreich:** Φ = f_g1·A·U_equiv·G_w·(θ_int − θ_m,e), mit U_equiv nach EN ISO 13370 aus B′ = A/(0,5·P) und d_t. Für Keller gelten Kellerboden und Kellerwand bis zur Tiefe z.
- **Boden und Decke:** Die Nachbarflächen werden je Raum durch Überlagerung mit den Geschossen darüber und darunter ermittelt.
  - Möglich sind: Erdreich, unbeheizter Raum (b_u nach Raumart, z. B. Garage 0,8), kühlerer beheizter Raum, Außenluft, Dachschräge (A/cos α), oberste Geschossdecke (b = 0,8) oder Flachdach.
  - Aussparungen (Treppenloch, Luftraum) werden abgezogen.
- **Lüftung:** Φ_V = 0,34 · n_min · V · (θ_int − θ_e) · (1 − η_WRG).
- **Nicht enthalten:** Wiederaufheizleistung, Grundwassereinfluss, Gewinne aus Nachbarräumen.

### Heizflächen

- **Lastaufteilung:** Die Raumheizlast wird proportional zur Leistungsfähigkeit der Flächen an ihrer Grenztemperatur verteilt.
  - Grenztemperaturen: Boden 29 °C bzw. 33 °C im Bad, Wand 35 °C, Decke 30 °C (Richtwerte).
- **Fußboden (Wasser):** EN 1264-2 Typ A mit systemabhängiger Überdeckung (Nass 45 mm, Fräs 15 mm, Trocken 25 mm mit Faktor 0,85).
  - a_B und a_T sind normgemäß; a_ü und a_D sind tabellarisch genähert.
- **Wand / Decke (Wasser):** Linienquellen-Widerstandsmodell K_H = k / (T/(2πλ)·ln(T/(πD)) + s/λ + 1/α) mit den Basiskennlinien nach EN 1264-5 (α_Wand = 8, α_Decke = 6 W/m²K). Die Trockenbau-Varianten sind genähert.
- **Elektro:** Wärmestromdichte = min(Bedarf, installierte Leistung, Grenzkurve); Stromkreise zu je höchstens 3,68 kW (16 A).
- **Vorlauftemperatur:** aus der höchsten Δθ_H aller Wasserflächen (Bad-Fußböden ausgenommen) bei σ = 5 K, exakt über den logarithmischen Mittelwert.
  - Für die übrigen Flächen wird σ numerisch bestimmt, mindestens 3 K.
  - Reicht der Vorlauf nicht, wird die Restleistung als Zusatzheizfläche ausgewiesen.
- **Kreise und Hydraulik:** Rohrlänge L = A/VA + 2·l_Anbindung; Aufteilung nach L_max und Δp_max; Massenstrom nach EN 1264-3 inkl. Rückseitenverlust; Druckverlust nach Darcy-Weisbach.

### Automatische Verteilung

- **Zuordnung:** Regret-Heuristik (Räume mit dem größten Nachteil bei Zweitwahl zuerst) unter Beachtung der Abgänge je Verteiler. Von Hand gewählte Verteiler bleiben erhalten.
- **Leitungsführung:** A* auf einem 10-cm-Raster. Kosten entstehen für Wanddurchbrüche (Türöffnungen sind frei, Außenwände gesperrt), fremde Räume und Richtungswechsel.
- **Verlegeabstand:** je Fläche der größte zulässige Abstand, der bei der Ziel-Vorlauftemperatur reicht. Von Hand gesetzte Abstände bleiben erhalten.

### Grundrisserkennung

1. Graustufen, Schwellwert nach Otsu.
2. Morphologisches Öffnen mit halber Mindestwanddicke entfernt Text, Maßketten und Türbögen.
3. Schließen mit halber Türbreite trennt die Räume an Türen; ein Schließen bis 3,2 m bestimmt die Gebäudehülle trotz Fenstern.
4. Konturverfolgung, Vereinfachung, Orthogonalisierung und Entfernen von Fensternischen ergeben die Raumpolygone.
5. Wände entstehen aus gegenüberliegenden Raumkanten (Innenwand) bzw. aus gemessener Wanddicke (Außenwand). Lücken in den Wänden werden zu Türen und Fenstern.

Die Erkennung arbeitet am besten mit gefüllt oder schraffiert gezeichneten Wänden. Das Ergebnis immer prüfen.

Die Klimadaten sind Richtwerte; verbindlich sind die nationalen Anhänge. Die Ergebnisse ersetzen nicht die geprüften Systemkennlinien des Herstellers.

## Entwicklung

```bash
npm install            # .npmrc setzt legacy-peer-deps
npm run dev            # Entwicklungsserver
npm test               # Vitest; IFC_SAMPLE=/pfad/modell.ifc prüft zusätzlich ein echtes IFC-Modell
npm run build          # statische Seite in dist/
npm run build:single   # eine eigenständige HTML-Datei in dist-single/ (läuft per Doppelklick)
```

```
src/
  model/      Datenmodell, Stammdaten, Bauteile, Heizsysteme, Normwerte, Normalisierung, Store (Undo/Redo, Phasen), Beispielprojekt
  cad/        Wandgeometrie, Bearbeiten, Öffnungen, Format übertragen
  geometry/   Polygone, Raster/Morphologie, Raum- und Grundrisserkennung, Verlegemuster, Rohrbögen, Heizfelder, Gelände
  calc/       Heizlast, EN 1264, Heizflächen, Hydraulik, Auslegung, automatische Verteilung, Klima-Interpolation
  ui/         Planeditor, Plandarstellung, Eigenschaften, Bauteilaufbau, Dialoge, Assistent, Wandansicht
  io/         Autosave, Projektdatei, PDF-, DXF-, IFC-Import, SVG-/DXF-Export, Auslegungsbericht
```

`dist/` ist eine rein statische Seite. Sie lässt sich z. B. auf Amazon S3 mit CloudFront (Origin Access Control) hosten oder mit Tauri als Desktop-App verpacken.
