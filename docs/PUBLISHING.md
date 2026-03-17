# Publishing Guide

This project is structured to be published as a standalone OpenClaw plugin
repository.

## Recommended Release Steps

1. Create a dedicated git repository for `tool-guard`
2. Commit the full project tree
3. Tag a release that matches `package.json`
4. Publish the repository or package archive
5. Share the install command:

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

macOS / Linux:

```bash
chmod +x ./scripts/install.sh
./scripts/install.sh
```

## What Must Be Included

- `index.ts`
- `openclaw.plugin.json`
- `package.json`
- `README.md`
- `LICENSE`
- `examples/rules/*.json`
- `scripts/install.ps1`
- `scripts/install.sh`
- `scripts/uninstall.ps1`
- `scripts/uninstall.sh`

## Upgrade Flow

When releasing a new version:

1. Update `package.json`
2. Update `README.md` if install/config changes
3. Update bundled rule files if defaults change
4. Ask users to pull the new version
5. Re-run:

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

macOS / Linux:

```bash
./scripts/install.sh
```

## Notes

- The installer is idempotent and can be re-run safely
- Plugin runtime state is intentionally ignored via `.gitignore`
- Confirmation commands are available in OpenClaw chat/native command surfaces
