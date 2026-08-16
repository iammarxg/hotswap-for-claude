import os
import json
import shutil
import zipfile
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(PROJECT_ROOT, "src")
DIST_DIR = os.path.join(PROJECT_ROOT, "dist")
STORE_ASSETS_DIR = os.path.join(PROJECT_ROOT, "store-assets")

RUNTIME_FILES = [
    "background.js",
    "blob-capture-init.js",
    "export-page-script.js",
    "popup.html",
    "popup.js",
    "popup.css",
]

RUNTIME_DIRS = [
    "icons"
]

def load_manifest():
    manifest_path = os.path.join(SRC_DIR, "manifest.json")
    if not os.path.exists(manifest_path):
        raise FileNotFoundError(f"Missing {manifest_path}")
    with open(manifest_path, "r", encoding="utf-8") as f:
        return json.load(f)

def clean_dir(dir_path):
    if os.path.exists(dir_path):
        shutil.rmtree(dir_path)
    os.makedirs(dir_path, exist_ok=True)

def copy_runtime_files(target_dir):
    for f in RUNTIME_FILES:
        src_file = os.path.join(SRC_DIR, f)
        dst_file = os.path.join(target_dir, f)
        if os.path.exists(src_file):
            shutil.copy2(src_file, dst_file)
        else:
            print(f"Warning: Runtime file not found: {src_file}")
            
    for d in RUNTIME_DIRS:
        src_subdir = os.path.join(SRC_DIR, d)
        dst_subdir = os.path.join(target_dir, d)
        if os.path.exists(src_subdir):
            shutil.copytree(src_subdir, dst_subdir, dirs_exist_ok=True)
        else:
            print(f"Warning: Runtime dir not found: {src_subdir}")

def create_zip(source_dir, output_zip_path):
    os.makedirs(os.path.dirname(output_zip_path), exist_ok=True)
    with zipfile.ZipFile(output_zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        for root, _, files in os.walk(source_dir):
            for file in sorted(files):
                file_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_path, source_dir)
                zipf.write(file_path, arcname=rel_path)
    print(f"  [+] Created archive: {output_zip_path} ({os.path.getsize(output_zip_path):,} bytes)")

def build_chrome(manifest, version_assets_dir):
    print("Building Chrome production variant...")
    chrome_dist = os.path.join(DIST_DIR, "chrome")
    clean_dir(chrome_dist)
    copy_runtime_files(chrome_dist)
    
    # Write Chrome manifest
    chrome_manifest_path = os.path.join(chrome_dist, "manifest.json")
    with open(chrome_manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        
    version = manifest.get("version", "1.0.0")
    zip_name = f"hotswap-for-claude-chrome-v{version}.zip"
    zip_path = os.path.join(version_assets_dir, zip_name)
    create_zip(chrome_dist, zip_path)
    return zip_path

def build_firefox(manifest, version_assets_dir):
    print("Building Firefox production variant...")
    firefox_dist = os.path.join(DIST_DIR, "firefox")
    clean_dir(firefox_dist)
    copy_runtime_files(firefox_dist)
    
    # Create Firefox-optimized manifest
    firefox_manifest = json.loads(json.dumps(manifest)) # deep copy
    
    # Inject Mozilla browser_specific_settings
    firefox_manifest["browser_specific_settings"] = {
        "gecko": {
            "id": "hotswap-for-claude@extension",
            "strict_min_version": "109.0"
        }
    }
    
    # Ensure Firefox-compatible background definition
    firefox_manifest["background"] = {
        "scripts": ["background.js"]
    }
    
    firefox_manifest_path = os.path.join(firefox_dist, "manifest.json")
    with open(firefox_manifest_path, "w", encoding="utf-8") as f:
        json.dump(firefox_manifest, f, indent=2)
        
    version = manifest.get("version", "1.0.0")
    zip_name = f"hotswap-for-claude-firefox-v{version}.zip"
    zip_path = os.path.join(version_assets_dir, zip_name)
    create_zip(firefox_dist, zip_path)
    return zip_path

def main():
    print("========================================")
    print(" HotSwap for Claude — Automated Packager")
    print("========================================")
    
    manifest = load_manifest()
    version = manifest.get("version", "1.0.0")
    print(f"Target Version: v{version}")
    
    version_assets_dir = os.path.join(STORE_ASSETS_DIR, f"v{version}")
    os.makedirs(version_assets_dir, exist_ok=True)

    # Sync marketing images (icons, promo tiles, screenshots) from root or v1.0.0
    v1_dir = os.path.join(STORE_ASSETS_DIR, "v1.0.0")
    if os.path.exists(v1_dir) and v1_dir != version_assets_dir:
        for img_file in os.listdir(v1_dir):
            if img_file.endswith((".png", ".jpg", ".jpeg", ".svg")) and not img_file.endswith(".zip"):
                src_img = os.path.join(v1_dir, img_file)
                dst_img = os.path.join(version_assets_dir, img_file)
                if not os.path.exists(dst_img):
                    shutil.copy2(src_img, dst_img)

    chrome_zip = build_chrome(manifest, version_assets_dir)
    firefox_zip = build_firefox(manifest, version_assets_dir)

    # Also create default zip name
    default_zip = os.path.join(version_assets_dir, f"hotswap-for-claude-v{version}.zip")
    shutil.copy2(chrome_zip, default_zip)
    
    print("\nPackage Build Summary:")
    print(f"  Chrome Dist:    {os.path.join(DIST_DIR, 'chrome')}")
    print(f"  Firefox Dist:   {os.path.join(DIST_DIR, 'firefox')}")
    print(f"  Chrome Zip:     {chrome_zip}")
    print(f"  Firefox Zip:    {firefox_zip}")
    print(f"  Default Zip:    {default_zip}")
    print("Packaging complete!\n")

if __name__ == "__main__":
    main()
