"""Generate bespoke 3D models for a Studio shot's text-to-3D props.

    python generate.py <shot folder or zip> [--provider meshy|tripo|manual] [--refine] [--only id1,id2] [--force]

Reads assets.json from a shot exported by the game's Studio ("Approve for Unreal"),
and for every prop whose route is "text3d" asks a text-to-3D service for a model,
saving it as generated/<prop id>.glb. Then run the Unreal script (vape_import.py) on the
same folder: it swaps each placeholder for its generated model.

Providers (plain Python 3.8+, no packages needed):
  meshy   Meshy text-to-3D API. Set MESHY_API_KEY. --refine adds full PBR textures (slower, more credits).
  tripo   Tripo text-to-model API. Set TRIPO_API_KEY.
  manual  Writes the prompts to TEXT3D_PROMPTS.md: generate them with any tool (web app,
          another API, a 3D artist) and save each as generated/<prop id>.glb (or .fbx/.obj).

The API calls follow each service's public docs at the time of writing but have not been
run from this repo (no keys in CI). If a service has changed, the error is printed with the
response body; ask Claude on your machine to adjust the provider class.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import zipfile


def http(method, url, token, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {url} -> HTTP {e.code}: {e.read().decode(errors='replace')[:500]}")


def download(url, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with urllib.request.urlopen(url, timeout=300) as r, open(path, "wb") as f:
        f.write(r.read())


class Meshy:
    BASE = "https://api.meshy.ai/openapi/v2/text-to-3d"

    def __init__(self, refine):
        self.token = os.environ.get("MESHY_API_KEY") or sys.exit("Set MESHY_API_KEY (from your Meshy account's API settings).")
        self.refine = refine

    def _wait(self, task_id, label):
        while True:
            t = http("GET", f"{self.BASE}/{task_id}", self.token)
            status = t.get("status")
            print(f"  {label}: {status} {t.get('progress', '')}%", flush=True)
            if status == "SUCCEEDED":
                return t
            if status in ("FAILED", "CANCELED", "EXPIRED"):
                raise RuntimeError(f"{label} {status}: {t.get('task_error') or t}")
            time.sleep(8)

    def generate(self, prompt):
        task = http("POST", self.BASE, self.token, {"mode": "preview", "prompt": prompt[:600], "art_style": "realistic", "should_remesh": True})
        done = self._wait(task["result"], "preview")
        if self.refine:
            task = http("POST", self.BASE, self.token, {"mode": "refine", "preview_task_id": task["result"], "enable_pbr": True})
            done = self._wait(task["result"], "refine")
        return done["model_urls"]["glb"]


class Tripo:
    BASE = "https://api.tripo3d.ai/v2/openapi/task"

    def __init__(self, refine):
        self.token = os.environ.get("TRIPO_API_KEY") or sys.exit("Set TRIPO_API_KEY (from your Tripo account's API keys).")
        self.refine = refine

    def generate(self, prompt):
        task = http("POST", self.BASE, self.token, {"type": "text_to_model", "prompt": prompt[:1000]})
        task_id = task["data"]["task_id"]
        while True:
            t = http("GET", f"{self.BASE}/{task_id}", self.token)["data"]
            print(f"  {t.get('status')} {t.get('progress', '')}%", flush=True)
            if t.get("status") == "success":
                out = t.get("output", {})
                return out.get("pbr_model") or out.get("model") or out.get("base_model")
            if t.get("status") in ("failed", "cancelled", "banned", "expired", "unknown"):
                raise RuntimeError(f"Tripo task {t.get('status')}: {t}")
            time.sleep(8)


def open_shot(path):
    path = os.path.abspath(os.path.expanduser(path))
    if zipfile.is_zipfile(path):
        folder = os.path.splitext(path)[0]
        os.makedirs(folder, exist_ok=True)
        with zipfile.ZipFile(path) as zf:
            for m in zf.namelist():
                if not os.path.exists(os.path.join(folder, m)):
                    zf.extract(m, folder)
        path = folder
    with open(os.path.join(path, "assets.json"), encoding="utf-8") as f:
        return path, json.load(f)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("shot")
    p.add_argument("--provider", default="manual", choices=["meshy", "tripo", "manual"])
    p.add_argument("--refine", action="store_true")
    p.add_argument("--only", default="")
    p.add_argument("--force", action="store_true")
    a = p.parse_args(argv)
    folder, plan = open_shot(a.shot)
    todo = [x for x in plan.get("props", []) if x.get("route") == "text3d"]
    if a.only:
        keep = set(a.only.split(","))
        todo = [x for x in todo if x["id"] in keep]
    if not todo:
        print("No text-to-3D props in this shot.")
        return
    gen = os.path.join(folder, "generated")
    os.makedirs(gen, exist_ok=True)
    if a.provider == "manual":
        lines = ["# Text-to-3D prompts", "", "Generate each model with any tool and save it in `generated/` with the file name shown.", ""]
        for x in todo:
            lines += [f"## {x['name']}  ->  generated/{x['id']}.glb", "", f"Size in the scene: about {' x '.join(f'{v:.2f}' for v in x.get('size', [1, 1, 1]))} m (w x h x d)", "", x.get("prompt", ""), ""]
        with open(os.path.join(folder, "TEXT3D_PROMPTS.md"), "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        print(f"Wrote {os.path.join(folder, 'TEXT3D_PROMPTS.md')} with {len(todo)} prompt(s).")
        return
    provider = (Meshy if a.provider == "meshy" else Tripo)(a.refine)
    status_path = os.path.join(gen, "status.json")
    status = json.load(open(status_path, encoding="utf-8")) if os.path.exists(status_path) else {}
    for x in todo:
        out = os.path.join(gen, f"{x['id']}.glb")
        if os.path.exists(out) and not a.force:
            print(f"{x['name']}: already have {out} (use --force to redo)")
            continue
        print(f"{x['name']}: generating with {a.provider}...")
        try:
            url = provider.generate(x["prompt"])
            download(url, out)
            status[x["id"]] = {"provider": a.provider, "file": out, "ok": True}
            print(f"  saved {out}")
        except Exception as e:
            status[x["id"]] = {"provider": a.provider, "ok": False, "error": str(e)}
            print(f"  FAILED: {e}")
        with open(status_path, "w", encoding="utf-8") as f:
            json.dump(status, f, indent=2)
    print("Done. Now run vape_import.py on this folder in Unreal (import_mode='skip' if it's already imported).")


if __name__ == "__main__":
    main()
