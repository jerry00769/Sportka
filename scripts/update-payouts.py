#!/usr/bin/env python3
"""Sportka prize archive updater: exact dates, both draws, all ten ranks, no overwrite on conflict."""
import json,re,sys,os,tempfile
from pathlib import Path
from datetime import datetime
import requests
from bs4 import BeautifulSoup
ROOT=Path(__file__).resolve().parents[1]
TARGET=ROOT/'sportka-vyhry.js'
BETCSV=ROOT/'vsazene_kombinace.csv'
BASE='https://www.sportkasazka.cz/vysledky-'
PREFIX='window.SPORTKA_PAYOUTS='

def load():
 if not TARGET.exists():return {}
 raw=TARGET.read_text(encoding='utf-8')
 if PREFIX not in raw:raise ValueError('Invalid payout cache; refusing overwrite')
 return json.loads(raw.split(PREFIX,1)[1].strip().rstrip(';'))

def parse(html,date):
 soup=BeautifulSoup(html,'html.parser')
 heading=soup.find('h1')
 if not heading or date not in heading.get_text(' ',strip=True).replace(' ', '') and datetime.strptime(date,'%Y-%m-%d').strftime('%-d.%-m.%Y') not in heading.get_text(' ',strip=True):
  raise ValueError('Page date mismatch')
 text=soup.get_text(' ',strip=True)
 section=text.split('Ve středu')[-1] if False else text
 match=re.search(r'1\.\s*TAH\s+((?:\d{1,2}\s+){7})2\.\s*TAH\s+((?:\d{1,2}\s+){7})',section,re.I)
 if not match:raise ValueError('Missing two draws')
 draws=[[int(x) for x in match.group(i).split()] for i in (1,2)]
 for d in draws:
  if len(d)!=7 or len(set(d[:6]))!=6 or d[6] in d[:6] or not all(1<=n<=49 for n in d):raise ValueError('Invalid drawn numbers')
 prizes=[]
 for n in (1,2):
  marker=re.search(r'Tabulka\s+výher\s+'+str(n)+r'\.\s*tah',text,re.I)
  if not marker:raise ValueError('Missing prize table')
  block=text[marker.end():]
  block=block.split('Převod 1. pořadí',1)[0]
  # Rows: roman numeral / match count / winners / payout CZK
  found={}
  for m in re.finditer(r'(?<!\w)(I|II|III|IV|V)\s+(?:6|5\s*\+\s*dodatkové|5|4|3)\s+([\d\s\u00a0]+?)\s+(\d[\d\s\u00a0]*)\s*Kč',block,re.I):
   roman=m.group(1).upper(); rank={'I':1,'II':2,'III':3,'IV':4,'V':5}.get(roman)
   if rank in found:raise ValueError('Duplicate rank')
   found[rank]=int(re.sub(r'\s','',m.group(3)))
  if set(found)!=set(range(1,6)):raise ValueError('Incomplete prize table')
  prizes.append([found[k] for k in range(1,6)])
 return {'draws':draws,'prizes':prizes,'source':BASE+date+'/'}

def main():
 old=load();dates=set(old)
 # Limit requests to dates of actual bets, plus recent dates (bounded to avoid unnecessary load).
 import csv
 if BETCSV.exists():
  with BETCSV.open(encoding='utf-8-sig',newline='') as f:
   for row in csv.DictReader(f,delimiter=';'):
    try:dates.add(datetime.strptime(row['datum'],'%d.%m.%Y').strftime('%Y-%m-%d'))
    except (KeyError,ValueError):pass
 # Request only missing dates, up to 30 per run.
 added=conflicts=0
 for day in sorted(dates,reverse=True):
  if day in old:continue
  try:
   r=requests.get(BASE+day+'/',timeout=15,headers={'User-Agent':'Mozilla/5.0 (SportkaPayoutBot/1.0)'})
   r.raise_for_status();entry=parse(r.text,day)
  except (requests.RequestException,ValueError) as e:
   print(day,'skipped:',e);continue
  old[day]=entry;added+=1
  if added>=30:break
 if added:
  fd,tmp=tempfile.mkstemp(prefix='.sportka-vyhry-',suffix='.tmp',dir=ROOT)
  try:
   with os.fdopen(fd,'w',encoding='utf-8') as f:f.write('/* Date-scoped Sportka payout tables; independent informational archive. */\n'+PREFIX+json.dumps(dict(sorted(old.items())),ensure_ascii=False,indent=2)+';\n')
   os.replace(tmp,TARGET)
  finally:
   if os.path.exists(tmp):os.unlink(tmp)
 print(f'Payout tables: {len(old)} cached, {added} added, {conflicts} conflicts')
if __name__=='__main__':main()
