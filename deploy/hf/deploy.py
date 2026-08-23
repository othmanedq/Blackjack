"""Déploie Blackjack Royale sur un Space Hugging Face (exécuté par GitHub Actions).

Nécessite le secret HF_TOKEN (token « Write » créé sur huggingface.co,
Settings → Access Tokens), stocké dans GitHub : Settings → Secrets and
variables → Actions → New repository secret.
"""

import os
import sys
import time

from huggingface_hub import HfApi

SPACE_NAME = os.environ.get("SPACE_NAME") or "blackjack-royale"

token = os.environ.get("HF_TOKEN")
if not token:
    sys.exit(
        "Secret HF_TOKEN manquant. Ajoutez-le dans le dépôt GitHub : "
        "Settings → Secrets and variables → Actions → New repository secret."
    )

api = HfApi(token=token)
user = api.whoami()["name"]
repo_id = f"{user}/{SPACE_NAME}"
print(f"Compte Hugging Face : {user}")
print(f"Space cible         : {repo_id}")

api.create_repo(repo_id=repo_id, repo_type="space", space_sdk="docker", exist_ok=True)

# Le code du jeu, sans les fichiers inutiles au serveur.
api.upload_folder(
    folder_path=".",
    repo_id=repo_id,
    repo_type="space",
    commit_message="Déploiement Blackjack Royale",
    ignore_patterns=[
        ".git/**", ".github/**", "node_modules/**", "test/**", "deploy/**",
        "README.md", ".gitignore",
    ],
)
# Dockerfile + fiche du Space (avec le port attendu par Hugging Face).
api.upload_file(path_or_fileobj="deploy/hf/Dockerfile", path_in_repo="Dockerfile",
                repo_id=repo_id, repo_type="space")
api.upload_file(path_or_fileobj="deploy/hf/README.md", path_in_repo="README.md",
                repo_id=repo_id, repo_type="space")

# URL publique du Space, pour que le QR code et les liens du jeu pointent juste.
info = api.space_info(repo_id)
subdomain = getattr(info, "subdomain", None)
if not subdomain:
    subdomain = repo_id.replace("/", "-").replace("_", "-").replace(".", "-").lower()
public_url = f"https://{subdomain}.hf.space"
api.add_space_variable(repo_id=repo_id, key="PUBLIC_URL", value=public_url)

print("Build du Space en cours…")
deadline = time.time() + 600
stage = None
while time.time() < deadline:
    stage = api.get_space_runtime(repo_id).stage
    print(f"  état : {stage}")
    if stage == "RUNNING":
        break
    if stage in ("BUILD_ERROR", "RUNTIME_ERROR", "CONFIG_ERROR"):
        sys.exit(f"Échec du déploiement ({stage}) — logs : https://huggingface.co/spaces/{repo_id}")
    time.sleep(10)

if stage != "RUNNING":
    sys.exit("Le build n'a pas abouti en 10 minutes — voir https://huggingface.co/spaces/" + repo_id)

print("=" * 62)
print(f"  🃏 Jeu en ligne  : {public_url}")
print(f"  🖥️ Vue table     : {public_url}/host")
print(f"  ⚙️ Gestion       : https://huggingface.co/spaces/{repo_id}")
print("=" * 62)
