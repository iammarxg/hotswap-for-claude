import os
import json
import shutil
import zipfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
EXTENSION_DIR = os.path.join(SCRIPT_DIR, "extension") if os.path.exists(os.path.join(SCRIPT_DIR, "extension")) else SCRIPT_DIR
DIST_DIR = os.path.join(SCRIPT_DIR, "dist")

def load_manifest():
    manifest_path = os.path.join(EXTENSION_DIR, "manifest.json")
    if not os.path.exists(manifest_path):
        raise FileNotFoundError(f"Missing manifest.json at {manifest_path}")
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    desc = manifest.get("description", "")
    if len(desc) > 132:
        raise ValueError(f"Manifest description too long: {len(desc)} chars (max 132 for Chrome Web Store):\n'{desc}'")
    return manifest

def create_zip(source_dir, output_zip_path):
    os.makedirs(os.path.dirname(output_zip_path), exist_ok=True)
    with zipfile.ZipFile(output_zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        for root, _, files in os.walk(source_dir):
            for file in sorted(files):
                file_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_path, source_dir)
                zipf.write(file_path, arcname=rel_path)
    print(f"  [+] Created archive: {output_zip_path} ({os.path.getsize(output_zip_path):,} bytes)")

def build_chrome(manifest):
    print("Building Chrome production variant...")
    chrome_dist = os.path.join(DIST_DIR, "chrome")
    shutil.rmtree(chrome_dist, ignore_errors=True)
    shutil.copytree(EXTENSION_DIR, chrome_dist)
    
    if os.path.exists(os.path.join(SCRIPT_DIR, "LICENSE")):
        shutil.copy2(os.path.join(SCRIPT_DIR, "LICENSE"), os.path.join(chrome_dist, "LICENSE"))
        
    version = manifest.get("version", "1.0.1")
    zip_path = os.path.join(DIST_DIR, f"hotswap-for-claude-chrome-v{version}.zip")
    create_zip(chrome_dist, zip_path)
    return zip_path

def build_firefox(manifest):
    print("Building Firefox production variant...")
    firefox_dist = os.path.join(DIST_DIR, "firefox")
    shutil.rmtree(firefox_dist, ignore_errors=True)
    shutil.copytree(EXTENSION_DIR, firefox_dist)
    
    if os.path.exists(os.path.join(SCRIPT_DIR, "LICENSE")):
        shutil.copy2(os.path.join(SCRIPT_DIR, "LICENSE"), os.path.join(firefox_dist, "LICENSE"))
    
    firefox_manifest = json.loads(json.dumps(manifest))
    firefox_manifest["browser_specific_settings"] = {
        "gecko": {
            "id": "hotswap-for-claude@extension",
            "strict_min_version": "142.0",
            "data_collection_permissions": {
                "required": ["none"]
            }
        }
    }
    firefox_manifest["background"] = {
        "scripts": ["background.js"]
    }
    
    with open(os.path.join(firefox_dist, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(firefox_manifest, f, indent=2)
        
    version = manifest.get("version", "1.0.1")
    zip_path = os.path.join(DIST_DIR, f"hotswap-for-claude-firefox-v{version}.zip")
    create_zip(firefox_dist, zip_path)
    return zip_path

def main():
    print("========================================")
    print(" HotSwap for Claude — Automated Packager")
    print("========================================")
    manifest = load_manifest()
    version = manifest.get("version", "1.0.1")
    print(f"Target Version: v{version}")
    
    chrome_zip = build_chrome(manifest)
    firefox_zip = build_firefox(manifest)
    
    default_zip = os.path.join(DIST_DIR, f"hotswap-for-claude-v{version}.zip")
    shutil.copy2(chrome_zip, default_zip)
    
    print("\nPackage Build Summary:")
    print(f"  Chrome Dist:    {os.path.join(DIST_DIR, 'chrome')}")
    print(f"  Firefox Dist:   {os.path.join(DIST_DIR, 'firefox')}")
    print(f"  Chrome Zip:     {chrome_zip}")
    print(f"  Firefox Zip:    {firefox_zip}")
    print("Packaging complete!\n")

if __name__ == "__main__":
    main()
