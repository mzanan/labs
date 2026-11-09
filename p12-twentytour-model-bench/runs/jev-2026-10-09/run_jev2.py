import json, os, subprocess, sys, time
import httpx
sys.path.insert(0, "../..")
from tracks import CLASSIFY_SYSTEM, INTENTS, load

MODEL = os.environ.get("JEV_MODEL", "typesafe/jev-1.13")
key = json.loads(subprocess.run(["infisical","export","--projectId=07efaa58-b52e-42e5-8400-f6971676074e","--env=dev","--path=/shared-ai-keys","--format=json"],capture_output=True,text=True,cwd="/tmp").stdout)
key = next(i["value"] for i in key if i["key"]=="OPENROUTER_API_KEY_MZANAN_NET")
LIMIT = int(os.environ.get("LIMIT", "0"))
CRIT = {
 "private_request":"asks for a new private or group tour or an offer",
 "change_request":"changes date, time or group size of an existing booking",
 "cancellation":"cancels a booking or asks for a refund",
 "resend_confirmation":"lost or missing booking confirmation",
 "question":"general question about tours",
 "late_or_lost":"customer is on the way, late or cannot find the group right now",
 "other":"spam, thanks, anything else"}
LANG={"en":"English","de":"German","fr":"French","es":"Spanish","nl":"Dutch","no":"Norwegian","it":"Italian","pt":"Portuguese","other":"any other language"}
cells=[]; err=0
with httpx.Client(headers={"Authorization":f"Bearer {key}"},timeout=60) as c:
    for s in load("classify"):
        for rep in (1,2,3):
            if LIMIT and len(cells)>=LIMIT: break
            body={"model":MODEL,"state":{"channel":s["channel"],"customer_message":s["text"]},
              "questions":{"language":{"type":"choice","instructions":"Pick the language the customer wrote the message in.","criteria":LANG},"intent":{"type":"choice","instructions":"Triage this inbound customer message of a walking-tour company. Pick the intent.","criteria":CRIT}}}
            t=time.monotonic(); r=c.post("https://openrouter.ai/api/v1/systemone",json=body); ms=round((time.monotonic()-t)*1000,1)
            cell={"scenario":s["id"],"rep":rep,"latency_ms":ms,"status":r.status_code,"gold":s["gold"]["intent"]}
            try:
                d=r.json(); a=d["answers"]["intent"]; cell.update(language=d["answers"]["language"]["choice"],answer=a["choice"],confidence=a.get("confidence"),cost_usd=(d.get("usage") or {}).get("cost",0),ok=True)
            except Exception as e:
                cell.update(ok=False,error=r.text[:300],cost_usd=0,answer=None); err+=1
            cell["language_ok"]=cell.get("language")==s["gold"]["language"]; cell["intent_ok"]=cell.get("answer")==s["gold"]["intent"]
            cells.append(cell)
            if err>=3: break
        if err>=3 or (LIMIT and len(cells)>=LIMIT): break
tot=sum(x["cost_usd"] for x in cells)
summ={"model":MODEL,"language":f"{sum(x['language_ok'] for x in cells)}/{len(cells)}","intent":f"{sum(x['intent_ok'] for x in cells)}/{len(cells)}","failed_calls":err,"cost_usd":round(tot,6),"mean_latency_ms":round(sum(x["latency_ms"] for x in cells)/len(cells)),
 "misses":[(x["scenario"],x["rep"],x["gold"],x["answer"],x["language"],x["language_ok"]) for x in cells if not (x["intent_ok"] and x["language_ok"])]}
print(json.dumps(summ,indent=1))
if not LIMIT: json.dump({"summary":summ,"cells":cells},open("jev-intent-language.json","w"),indent=1)
