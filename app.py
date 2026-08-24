"""SENTINEL dashboard backend: mobile camera -> YOLO -> live dashboard."""
from __future__ import annotations
import json, os, sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import cv2, numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from ultralytics import YOLO

ROOT=Path(__file__).parent; DB=ROOT/"sentinel.db"; model: YOLO|None=None; latest_frame: bytes|None=None; clients:set[WebSocket]=set()
def connection():
    con=sqlite3.connect(DB); con.row_factory=sqlite3.Row; return con
def setup_db():
    with connection() as con: con.execute("""CREATE TABLE IF NOT EXISTS observations (id INTEGER PRIMARY KEY,created_at TEXT NOT NULL,robot_id TEXT NOT NULL,latitude REAL,longitude REAL,battery_pct REAL,temperature_c REAL,transcript TEXT NOT NULL,detections TEXT NOT NULL,critical_score REAL NOT NULL,priority TEXT NOT NULL)""")
@asynccontextmanager
async def life(_:FastAPI):
    global model
    setup_db(); model=YOLO(os.getenv("YOLO_MODEL","yolo11n.pt")); yield
app=FastAPI(title="SENTINEL-01",lifespan=life); app.mount("/assets",StaticFiles(directory=ROOT),name="assets")
class MobileTelemetry(BaseModel):
    robot_id:str=Field(default="sentinel-01",max_length=64); latitude:float|None=Field(default=None,ge=-90,le=90); longitude:float|None=Field(default=None,ge=-180,le=180); battery_pct:float|None=Field(default=None,ge=0,le=100); temperature_c:float|None=Field(default=None,ge=-50,le=100); transcript:str=Field(default="",max_length=2000)
def risk_score(ds:list[dict[str,Any]],text:str)->float:
    person=max((x["confidence"] for x in ds if x["label"]=="person"),default=0); hazard={"fire","smoke","knife","gas","flame"}; score=person*.6+(30 if {x["label"] for x in ds}&hazard else 0)
    if any(w in text.lower() for w in ("help","trapped","injured","bachao","madad","zakhmi")):score+=20
    return round(min(score,100),1)
async def broadcast(event:dict[str,Any]):
    stale=[]
    for ws in clients:
        try: await ws.send_json(event)
        except Exception: stale.append(ws)
    for ws in stale: clients.discard(ws)
@app.get("/")
async def dashboard(): return FileResponse(ROOT/"index.html")
@app.get("/mobile")
async def mobile(): return FileResponse(ROOT/"mobile.html")
@app.get("/api/live-frame")
async def live_frame():
    if latest_frame is None: raise HTTPException(404,"Waiting for phone camera")
    return Response(latest_frame,media_type="image/jpeg",headers={"Cache-Control":"no-store"})
@app.get("/api/history")
async def history():
    with connection() as con: rows=con.execute("SELECT * FROM observations ORDER BY id DESC LIMIT 50").fetchall()
    return [dict(row)|{"detections":json.loads(row["detections"])} for row in rows]
@app.websocket("/ws/dashboard")
async def socket(ws:WebSocket):
    await ws.accept(); clients.add(ws)
    try:
        while True: await ws.receive_text()
    except WebSocketDisconnect: clients.discard(ws)
@app.post("/api/observe")
async def observe(meta:str=Form(...),image:UploadFile=File(...)):
    global latest_frame
    if model is None: raise HTTPException(503,"YOLO is loading")
    try:
        data=MobileTelemetry.model_validate_json(meta); frame=cv2.imdecode(np.frombuffer(await image.read(),np.uint8),cv2.IMREAD_COLOR)
        if frame is None: raise ValueError("camera image could not be decoded")
    except Exception as exc: raise HTTPException(400,f"Invalid mobile observation: {exc}") from exc
    output=model(frame,verbose=False,imgsz=640)[0]; ds=[]
    for box in output.boxes:
        confidence=round(float(box.conf[0])*100,1)
        if confidence>=35: ds.append({"label":output.names[int(box.cls[0])],"confidence":confidence})
    ok,jpeg=cv2.imencode(".jpg",output.plot(),[cv2.IMWRITE_JPEG_QUALITY,76])
    if ok: latest_frame=jpeg.tobytes()
    critical=risk_score(ds,data.transcript); priority="CRITICAL" if critical>=75 else "WATCH" if critical>=40 else "NORMAL"; event=data.model_dump()|{"created_at":datetime.now(timezone.utc).isoformat(),"detections":ds,"critical_score":critical,"priority":priority}
    with connection() as con:
        cur=con.execute("INSERT INTO observations (created_at,robot_id,latitude,longitude,battery_pct,temperature_c,transcript,detections,critical_score,priority) VALUES (:created_at,:robot_id,:latitude,:longitude,:battery_pct,:temperature_c,:transcript,:detections,:critical_score,:priority)",event|{"detections":json.dumps(ds)}); event["id"]=cur.lastrowid
    await broadcast(event); return event
