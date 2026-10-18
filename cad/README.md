# HausCAD

Eigenständiges, schlankes Haus-CAD im Browser – angelehnt an Sweet Home 3D und RoomSketcher.
Es dient zum Zeichnen von Wänden, Räumen, Türen, Fenstern, Treppen und Möbeln. Grundriss und 3D-Ansicht sind live gekoppelt; der Austausch mit AutoCAD/CADCraft (DXF) und HeatCircuits ist eingebaut.

```bash
npm run cad:dev             # Entwicklungsserver (Port 5174)
npm run cad:build           # statische Seite in dist-cad/
npm run cad:build:single    # eine HTML-Datei in dist-cad-single/ (läuft per Doppelklick, auch offline)
```

## Funktionen

| Bereich | Umfang |
| --- | --- |
| Zeichnen | Raum aufziehen (Wände + Raum in einem Zug, gemeinsame Wände werden nicht verdoppelt), Wandzüge mit Längeneingabe, Raumpolygon oder Doppelklick-Erkennung |
| Fangen | Wandenden, Wandachsen (T-Stoß teilt die Wand automatisch), Ausrichtungshilfen, 15°-Winkel, cm-Raster; ⌥/⇧ hebt das Fangen auf |
| Wände | Gehrung an L-, T- und Kreuzstößen, Dicke, Höhe, Farbe je Seite, Teilen, Richtung umkehren, Endpunkte verbundener Wände wandern mit |
| Öffnungen | Tür, Doppeltür, verglaste Schiebetür, Durchgang, Fenster, Fenstertür, Oberlicht, Garagentor; Öffnungsseite und Anschlag, Ziehen entlang und zwischen Wänden |
| Räume | exakte lichte Fläche (Kanten auf die Wandoberflächen gezogen), Bodenbelag mit prozeduraler Textur, Decken- und Bodenfarbe, „Wände um den Raum erzeugen“ |
| Möbel | rund 45 parametrische Objekte in 9 Kategorien (Wohnen, Essen, Küche, Schlafen, Bad, Arbeiten, Haustechnik, Außen); Wandmöbel legen sich magnetisch an, Drehen, Skalieren, Spiegeln |
| Treppen | gerade, viertelgewendelt mit Podest, Spindel; Steigungen aus der Geschosshöhe, Prüfung des Schrittmaßes nach DIN 18065, Deckenausschnitt im Geschoss darüber |
| Geschosse | beliebig viele, Kopie der Außenwände, Keller darunter, Geschoss darunter als Schatten im Plan |
| 3D | Luftbild (Orbit) und Rundgang (W A S D), Schatten, Satteldach/Walm/Pult/Flach mit Kniestock, Gelände, Klick wählt im Plan |
| Hintergrund | Grundrissbild mit Zwei-Punkt-Kalibrierung, DXF-Grundriss maßstäblich als Vektorhintergrund (mm/cm/m aus `$INSUNITS`) |
| Bearbeiten | Undo/Redo, Kopieren/Einfügen/Duplizieren, Rahmenauswahl, Mehrfachbearbeitung, Pfeiltasten in 1/10 cm |
| Export | Projekt (`.hauscad`), Plan als SVG (M 1:100) und DXF R12 (Layer WAENDE, OEFFNUNGEN, RAEUME, MOEBEL, TREPPEN, MASSE, TEXT), 3D als PNG, GLB und OBJ, Übergabe an HeatCircuits |

## Übergabe an HeatCircuits

*Datei › An HeatCircuits übergeben* erzeugt eine HeatCircuits-Projektdatei mit folgendem Inhalt:

- Geschosse mit Höhen;
- Außen- und Innenwände (Außenwand: auf einer Seite kein Raum);
- Fenster, Türen, Außentüren und Garagentore;
- Raumarten aus dem Raumnamen (Bad, Küche, Flur …);
- Deckenöffnungen der Treppen;
- Heizkreisverteiler und Wärmepumpe, sofern sie aus dem Katalog gesetzt wurden.

In HeatCircuits wird die Datei mit *Projekt › Öffnen* geladen.

## Datenaustausch mit CADCraft und AutoCAD

[CADCraft](https://github.com/storytold/cadcraft) (MIT/Apache-2.0, Rust, frühe Entwicklung) liest und schreibt DXF. HausCAD schreibt DXF R12 in Metern und liest ASCII-DXF:

- LINE, LWPOLYLINE, POLYLINE, ARC, CIRCLE, TEXT/MTEXT;
- INSERT bis zu drei Ebenen tief.

DWG wird nicht direkt gelesen und muss vorher nach DXF gewandelt werden, z. B. mit CADCraft oder dem ODA File Converter.

## Aufbau

```
cad/src/
  model.ts       Datenmodell, Vorgaben, Migration
  walls.ts       Gehrungen, Wandumrisse, Projektion auf Wände
  edit.ts        Wandzüge mit T-Stößen, Rechteckräume, Raumerkennung, Verschieben, Kopieren, Drehen
  stairs.ts      Stufen- und Umrissgeometrie
  catalog.ts     Möbelkatalog: Planzeichen (SVG) und 3D-Modelle (Three.js)
  plan-render.ts SVG-Darstellung, plan.ts Editor mit Werkzeugen und Fangen
  view3d.ts      3D-Ansicht, Rundgang, Dach, Bodentexturen
  props.ts       Eigenschaften, io.ts Dateien/DXF/HeatCircuits, sample.ts Beispielhaus
```

Geometrie-Grundfunktionen und die Raumerkennung werden aus `src/geometry` von HeatCircuits mitgenutzt.
