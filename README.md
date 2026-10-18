# HeatCircuits

Planungssoftware für Flächenheizungen, inspiriert von LoopCAD und auf Europa ausgerichtet:
metrische Einheiten, °C, Heizlast in Anlehnung an **EN 12831-1 / DIN/TS 12831-1**, Erdreich nach **EN ISO 13370**,
U-Werte nach **EN ISO 6946** und Auslegung nach **EN 1264-2/-3/-5**.
Die App läuft vollständig im Browser, ohne Server und ohne Konto.

## Ablauf

Der **Planungsassistent** führt durch acht Schritte:

1. **Projekt und Standort.** Norm-Außentemperatur und Jahresmittel für DE, AT, CH und weitere EU-Städte.
2. **Gebäude.** Das Baujahr setzt Schichtaufbauten, Fenster und Wärmebrückenzuschlag (11 Baualtersklassen). Dazu kommen Außenwand, Bodenplatte bzw. Kellerdecke und Dach mit Dämmebene.
3. **Geschosse.** Vorlagen von EG bis Keller + EG + OG oder Dachgeschoss, mit Höhen und erdberührten Geschossen.
4. **Heizsystem.** Zur Wahl stehen Nasssystem, Fräs-System, Trockensystem und Elektro-Heizmatte. Die zulässigen Verlegeabstände (7,5 / 10 / 12,5 / 15 / 17,5 / 20 cm, erweiterbar) und die Ziel-Vorlauftemperatur werden hier festgelegt.
5. **Grundrisse.** Bild laden und den Maßstab über zwei Punkte mit bekanntem Abstand kalibrieren. Danach erkennt die App **Räume, Wände, Türen und Fenster automatisch**.
6. **Räume prüfen.** Raumart (Temperatur, Luftwechsel, Belag, Abstand) und Heizsystem je Raum.
7. **Verteiler setzen.** Danach werden die Heizkreise **automatisch erzeugt**: Raumzuordnung mit Kapazitätsgrenze, Leitungsführung um Wände und durch Türen, Verlegeabstände aus der zulässigen Liste.
8. **Ergebnis.** Kennzahlen, Tabellen und 3D-Ansicht.

## Funktionen

| Bereich | Umfang |
| --- | --- |
| Bauteile | Baustoffbibliothek (40 Materialien), Schichtaufbauten mit U-Wert nach EN ISO 6946, Vorlagen je Baualtersklasse, Fenstertypen |
| Zeichnen | Wände entlang der Achse mit Längeneingabe, Fenster, Türen, Außentüren und Garagentore als Wandöffnungen, gerade Treppen, Spindeltreppen und Lufträume als Deckenöffnungen |
| Räume | Erkennung per Klick oder aus dem Grundrissbild, Polygon, Rechteck; Garage im Haus, unbeheizter Keller und Dachboden mit Temperatur-Korrekturfaktor b_u |
| Heizflächen | mehrere je Raum: Fußboden (Nass, Fräs, Trocken, Elektro), Wandheizung (Putz, Trockenbau), Deckenheizung (Putz, Gipskarton) |
| Verlegung | Schnecke (bifilar) oder Mäander; Ecken mit Mindestbiegeradius 5 × D, enge 180°-Umlenkungen als Omega-Bogen; Aussparung von Treppenlöchern |
| Wandansicht | Doppelklick auf eine Wand: Abwicklung von der Raumseite mit Öffnungen, verschiebbaren Heizfeldern und Rohrbahnen um Fenster |
| 3D | Wände mit Öffnungen, Böden mit Treppenlöchern, Heizkreise, Wand- und Deckenheizflächen, Treppen, Sattel-, Walm-, Pult- und Flachdach mit Kniestock |
| Leitungen | Anbindeleitungen Raum → Verteiler (automatisch per A* oder manuell), Verteiler → Wärmeerzeuger inkl. Steigleitung |
| Ergebnisse | Heizlast je Bauteil und Nachbarfläche, Heizflächen, Heizkreise mit Druckverlust und Abgleich, Verteiler, Materialliste (Rohr je Typ, Rollen, Heizmatten, Randdämmstreifen) |
| Export | Projektdatei (JSON inkl. Bilder), Plan als SVG, 3D-Ansicht als PNG, Tabellen als CSV (Semikolon, Dezimalkomma); Autosave im Browser |

## Tastenkürzel

| Taste | Werkzeug |
| --- | --- |
| V / H | Auswählen / Ansicht verschieben (auch Leertaste) |
| W | Wand (Länge eintippen + Enter, Shift hebt Ortho auf) |
| E / R / Q | Raum erkennen / Polygon / Rechteck |
| O | Fenster, Tür oder Tor auf eine Wand setzen |
| T / S / U | Treppe / Spindeltreppe / Luftraum |
| M / L / G | Verteiler / Anbindeleitung / Wärmeerzeuger |
| K / B / D | Maßstab kalibrieren / Bild verschieben / Messen |
| 3 | Grundriss ↔ 3D |
| F, + / − | Einpassen, Zoom |
| Bild ↑ / Bild ↓ | Geschoss wechseln |
| ⌘/Strg + Z, ⇧⌘Z, ⌘/Strg + S | Rückgängig, Wiederholen, Speichern |

## Rechenverfahren

### Heizlast (vereinfacht nach EN 12831-1)

- **Transmission:** Φ_T = Σ A·(U + ΔU_WB)·b·(θ_int − θ_e).
  - Fenster- und Türflächen ergeben sich aus den gezeichneten Öffnungen.
  - Außenwandlängen werden entlang der Raumkontur ermittelt.
- **Erdreich:** Φ = f_g1·A·U_equiv·G_w·(θ_int − θ_m,e), mit U_equiv nach EN ISO 13370 aus B′ = A/(0,5·P) und d_t. Für Keller gelten Kellerboden und Kellerwand bis zur Tiefe z.
- **Boden und Decke:** Die Nachbarflächen werden je Raum durch Überlagerung mit den Geschossen darüber und darunter ermittelt.
  - Möglich sind: Erdreich, unbeheizter Raum (b_u nach Raumart, z. B. Garage 0,8), kühlerer beheizter Raum, Außenluft, Dachschräge (A/cos α), oberste Geschossdecke (b = 0,8) oder Flachdach.
  - Treppenlöcher werden ausgespart.
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
npm test               # Vitest: Geometrie, Erkennung, Bauteile, Heizlast, EN 1264, Hydraulik, Verteilung
npm run build          # statische Seite in dist/
npm run build:single   # eine eigenständige HTML-Datei in dist-single/ (läuft per Doppelklick)
```

```
src/
  model/      Datenmodell, Stammdaten, Bauteile, Heizsysteme, Store (Undo/Redo), Beispielprojekt
  geometry/   Polygone, Raster/Morphologie, Raum- und Grundrisserkennung, Verlegemuster, Rohrbögen, Heizfelder
  calc/       Heizlast, EN 1264, Heizflächen, Hydraulik, Auslegung, automatische Verteilung
  ui/         Editor, Darstellung, Seitenleiste, Dialoge, Assistent, Wandansicht, 3D (Three.js)
  io/         Autosave (IndexedDB), Projektdatei, SVG-Export
```

`dist/` ist eine rein statische Seite. Sie lässt sich z. B. auf Amazon S3 mit CloudFront (Origin Access Control) hosten oder mit Tauri als macOS-App verpacken.
