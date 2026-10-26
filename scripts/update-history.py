#!/usr/bin/env python3
"""Doplní ověřitelné losovací dny Sportky, nikdy nepřepisuje existující tahy.
Zdroj: veřejný archiv MrCasino. Při změně struktury webu bezpečně skončí bez změn.
"""
import csv
import re
import sys
from datetime import datetime
from pathlib import Path
import requests
from bs4 import BeautifulSoup

TARGET = Path(__file__).resolve().parents[1] / 'sportka.csv'
URL = 'https://www.mrcasino.cz/loterie/sportka/archiv'
DATE = re.compile(r'(?<!\d)(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})(?:\s*\((?:středa|pátek|neděle)\))?', re.I)
NUM = re.compile(r'(?<!\d)(?:[1-9]|[1-4]\d)(?!\d)')

def valid(numbers):
    return len(numbers) == 7 and len(set(numbers[:6])) == 6 and all(1 <= n <= 49 for n in numbers) and numbers[6] not in numbers[:6]

def fetch():
    r = requests.get(URL, timeout=25, headers={'User-Agent':'Mozilla/5.0 (compatible; SportkaHistoryBot/1.0)'})
    r.raise_for_status()
    soup = BeautifulSoup(r.text, 'html.parser')
    # Textový výpis: datum, první tah, šest čísel + bonus, druhý tah, šest + bonus.
    text = ' '.join(soup.stripped_strings)
    found = {}
    matches = list(DATE.finditer(text))
    print(f'Archiv: HTTP {r.status_code}, znaku {len(text)}, nalezenych dat {len(matches)}.')
    for i, m in enumerate(matches):
        segment = text[m.end():min(matches[i+1].start() if i+1 < len(matches) else m.end()+500, m.end()+500)]
        a = re.search(r'1\.?\s*TAH\b(.*?)2\.?\s*TAH\b(.*?)(?:ŠANCE|Ve hře|Výhry|$)', segment, re.I | re.S)
        if not a: continue
        # Omezíme se na sedm čísel každého tahu, ne na statistiky a reklamy.
        first = list(map(int, NUM.findall(a.group(1))))[:7]
        second = list(map(int, NUM.findall(a.group(2))))[:7]
        if not valid(first) or not valid(second): continue
        try: day = datetime(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError: continue
        if day.weekday() not in (2, 4, 6) or day > datetime.now(): continue
        found[day.strftime('%Y-%m-%d')] = (day, first, second)
    print(f'Archiv: platnych dvojic tahu {len(found)}.')
    return found

def main():
    with TARGET.open(encoding='utf-8-sig', newline='') as f:
        rows = list(csv.reader(f, delimiter=';'))
    if not rows or len(rows[0]) < 18: raise RuntimeError('Chybí platná hlavička CSV')
    known = set()
    for row in rows[1:]:
        if not row: continue
        try: known.add(datetime.strptime(row[0].replace(' ', ''), '%d.%m.%Y').strftime('%Y-%m-%d'))
        except ValueError: continue
    incoming = fetch()
    if not incoming: raise RuntimeError('Zdroj nevrátil žádné bezpečně parsovatelné losování; CSV nezměněno.')
    added = []
    for key, (day, first, second) in sorted(incoming.items(), reverse=True):
        if key in known: continue
        # Přesně 18 polí; zachováme formát původního souboru.
        added.append([f'{day.day}. {day.month}. {day.year}',str(day.year),str(day.isocalendar().week),str((day.weekday()+1)%7+1),*map(str,first),*map(str,second)])
    if not added:
        print(f'Beze změny; zdroj poskytl {len(incoming)} platných losování.')
        return
    # Zápis atomicky, bez změny původních řádků.
    import os, tempfile
    fd, temp = tempfile.mkstemp(dir=TARGET.parent, prefix='.sportka_', suffix='.tmp')
    try:
        with os.fdopen(fd,'w',encoding='utf-8',newline='') as f:
            writer=csv.writer(f,delimiter=';',lineterminator='\r\n')
            writer.writerow(rows[0]);writer.writerows(added);writer.writerows(rows[1:])
        os.replace(temp,TARGET)
    finally:
        if os.path.exists(temp):os.unlink(temp)
    print(f'Přidáno {len(added)} nových losování.')

if __name__=='__main__':
    try: main()
    except Exception as e:
        print(f'CHYBA: {e}',file=sys.stderr);sys.exit(1)
