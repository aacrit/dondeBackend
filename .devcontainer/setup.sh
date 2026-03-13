#!/bin/bash
set -e

# Install Claude Code
curl -fsSL https://claude.ai/install.sh | sh

# Install Supabase CLI
npm install -g supabase

# Clone frontend repo alongside backend
git clone https://github.com/aacrit/dondeAI.git /workspaces/dondeAI 2>/dev/null || true

# Create workspace root for cross-repo sessions
mkdir -p /workspaces/donde-workspace/.claude/agents
mkdir -p /workspaces/donde-workspace/.claude/commands

# Symlink both repos
ln -sf /workspaces/dondeBackend /workspaces/donde-workspace/backend
ln -sf /workspaces/dondeAI /workspaces/donde-workspace/frontend

# Copy agent definitions from both repos into workspace
cp /workspaces/dondeBackend/.claude/agents/*.md /workspaces/donde-workspace/.claude/agents/ 2>/dev/null || true
cp /workspaces/dondeAI/.claude/agents/*.md /workspaces/donde-workspace/.claude/agents/ 2>/dev/null || true

# Copy custom commands from both repos
cp /workspaces/dondeBackend/.claude/commands/*.md /workspaces/donde-workspace/.claude/commands/ 2>/dev/null || true
cp /workspaces/dondeAI/.claude/commands/*.md /workspaces/donde-workspace/.claude/commands/ 2>/dev/null || true

# Create workspace-level CLAUDE.md
cat > /workspaces/donde-workspace/CLAUDE.md << 'WORKSPACE_EOF'
# DondeAI Workspace

This workspace spans two repos:
- **Backend:** ./backend/ (dondeBackend — Supabase Edge Functions, PostgreSQL, scoring engine)
- **Frontend:** ./frontend/ (dondeAI — HTML/CSS/JS, GitHub Pages)

## Quick Reference
- Backend architecture: ./backend/BACKEND-ARCHITECTURE.md
- Scoring engine: ./backend/SCORING-ENGINE.md
- Frontend architecture: ./frontend/FRONTEND-ARCHITECTURE.md
- Design system: ./frontend/DESIGN-PRINCIPLES.md
- Test suites: ./frontend/TEST-LITE.md and ./frontend/TEST-FULL.md
- DB schema: ./backend/DB-SCHEMA.md

## Tools Available
- Supabase CLI: `supabase db push`, `supabase functions deploy`, `supabase migration new`
- Git: full access to both repos (separate histories)
- Node.js 20: for build scripts and tooling

## Rules
- Read the relevant MD files for context before touching code
- Only open source files when making changes
- Always run /test-lite before committing frontend changes
- Never modify RLS policies without explicit approval
- Run `supabase db push --dry-run` before applying migrations
- Commit to each repo separately (they have independent git histories)

## Git Workflow
The two repos have separate git histories. When committing:
  cd backend && git add -A && git commit -m "message" && git push
  cd ../frontend && git add -A && git commit -m "message" && git push
WORKSPACE_EOF

echo ""
echo "✅ DondeAI Codespace ready."
echo ""
echo "   Backend work (most common):"
echo "     cd /workspaces/dondeBackend && claude"
echo ""
echo "   Frontend work:"
echo "     cd /workspaces/dondeAI && claude"
echo ""
echo "   Full-stack work (both repos, all agents):"
echo "     cd /workspaces/donde-workspace && claude"
echo ""
echo "   Supabase CLI ready: run 'supabase --version' to verify"
