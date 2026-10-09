-- 0009: a fixed tag vocabulary (UI handoff "Tag groups", Option C). The classifier
-- may only pick tags from the `tags` setting; anything else goes to suggested_tags,
-- shown on the settings page so the list can grow. Four groups: the agent or editor a
-- tool works with, the models it uses, where it runs, and how you use it.
INSERT INTO settings (key, value) VALUES ('tags', '[{"slug":"works-with","label":"Works with","hint":"the coding agent or editor it plugs into or drives","tags":[{"slug":"claude-code","label":"Claude Code"},{"slug":"codex","label":"Codex"},{"slug":"cursor","label":"Cursor"},{"slug":"opencode","label":"OpenCode"},{"slug":"gemini-cli","label":"Gemini CLI"},{"slug":"pi","label":"Pi"},{"slug":"copilot","label":"GitHub Copilot"},{"slug":"windsurf","label":"Windsurf"},{"slug":"zed","label":"Zed"},{"slug":"vscode","label":"VS Code"},{"slug":"jetbrains","label":"JetBrains"},{"slug":"xcode","label":"Xcode"},{"slug":"any-agent","label":"Any agent"}]},{"slug":"models","label":"Models","hint":"whose AI models it uses","tags":[{"slug":"claude","label":"Claude"},{"slug":"openai","label":"OpenAI"},{"slug":"gemini","label":"Gemini"},{"slug":"deepseek","label":"DeepSeek"},{"slug":"qwen","label":"Qwen"},{"slug":"local-models","label":"Local models"},{"slug":"any-model","label":"Any model"}]},{"slug":"platform","label":"Platform","hint":"where it runs","tags":[{"slug":"macos","label":"macOS"},{"slug":"linux","label":"Linux"},{"slug":"windows","label":"Windows"},{"slug":"ios","label":"iOS"},{"slug":"self-hosted","label":"Self-hosted"},{"slug":"docker","label":"Docker"}]},{"slug":"interface","label":"Interface","hint":"how you use it","tags":[{"slug":"cli","label":"CLI"},{"slug":"desktop-app","label":"Desktop app"},{"slug":"web-app","label":"Web app"},{"slug":"editor-extension","label":"Editor extension"},{"slug":"mcp-server","label":"MCP server"},{"slug":"plugin","label":"Plugin or skill"},{"slug":"menu-bar","label":"Menu bar"},{"slug":"github-action","label":"GitHub Action"}]}]')
  ON CONFLICT (key) DO UPDATE SET value = excluded.value;

-- Map today's free-form tags onto the vocabulary (claude-code stays, terminal -> cli,
-- ollama -> local-models, ...) and drop the rest: languages come from GitHub stats and
-- topics from categories.
CREATE TABLE tag_map (old TEXT PRIMARY KEY, new TEXT NOT NULL);
INSERT INTO tag_map (old, new) VALUES
  ('anthropic', 'claude'),
  ('any-agent', 'any-agent'),
  ('any-model', 'any-model'),
  ('chatgpt', 'openai'),
  ('claude', 'claude'),
  ('claude code', 'claude-code'),
  ('claude-code', 'claude-code'),
  ('claude-code-plugin', 'claude-code'),
  ('claude-code-skills', 'plugin'),
  ('claudecode', 'claude-code'),
  ('cli', 'cli'),
  ('codex', 'codex'),
  ('codex-cli', 'codex'),
  ('copilot', 'copilot'),
  ('cursor', 'cursor'),
  ('deepseek', 'deepseek'),
  ('desktop', 'desktop-app'),
  ('desktop-app', 'desktop-app'),
  ('docker', 'docker'),
  ('editor-extension', 'editor-extension'),
  ('electron', 'desktop-app'),
  ('extension', 'editor-extension'),
  ('gemini', 'gemini'),
  ('gemini-cli', 'gemini-cli'),
  ('github-action', 'github-action'),
  ('github-actions', 'github-action'),
  ('github-copilot', 'copilot'),
  ('gpt', 'openai'),
  ('hooks', 'plugin'),
  ('intellij', 'jetbrains'),
  ('ios', 'ios'),
  ('jetbrains', 'jetbrains'),
  ('linux', 'linux'),
  ('llama.cpp', 'local-models'),
  ('lm-studio', 'local-models'),
  ('local', 'local-models'),
  ('local-llm', 'local-models'),
  ('local-llms', 'local-models'),
  ('local-models', 'local-models'),
  ('mac', 'macos'),
  ('macos', 'macos'),
  ('mcp', 'mcp-server'),
  ('mcp-server', 'mcp-server'),
  ('menu-bar', 'menu-bar'),
  ('menubar', 'menu-bar'),
  ('ollama', 'local-models'),
  ('openai', 'openai'),
  ('openai-codex', 'codex'),
  ('openai-compatible', 'openai'),
  ('opencode', 'opencode'),
  ('pi', 'pi'),
  ('pi-agent', 'pi'),
  ('pi-coding-agent', 'pi'),
  ('plugin', 'plugin'),
  ('plugins', 'plugin'),
  ('qwen', 'qwen'),
  ('self-hosted', 'self-hosted'),
  ('skill', 'plugin'),
  ('skills', 'plugin'),
  ('tauri', 'desktop-app'),
  ('terminal', 'cli'),
  ('visual-studio-code', 'vscode'),
  ('vs-code', 'vscode'),
  ('vscode', 'vscode'),
  ('vscode-extension', 'editor-extension'),
  ('web', 'web-app'),
  ('web-app', 'web-app'),
  ('windows', 'windows'),
  ('windsurf', 'windsurf'),
  ('xcode', 'xcode'),
  ('zed', 'zed');

UPDATE tools
SET tags = (
  SELECT json(coalesce(json_group_array(DISTINCT m.new), '[]'))
  FROM json_each(tools.tags) j JOIN tag_map m ON m.old = lower(trim(j.value))
);

UPDATE posts
SET classification = json_set(classification, '$.tags', (
  SELECT json(coalesce(json_group_array(DISTINCT m.new), '[]'))
  FROM json_each(posts.classification, '$.tags') j JOIN tag_map m ON m.old = lower(trim(j.value))
))
WHERE classification IS NOT NULL AND json_type(classification, '$.tags') = 'array';

-- Reviewer corrections are overlaid on classifications for few-shot examples.
UPDATE review_decisions
SET corrected_fields = json_set(corrected_fields, '$.tags', (
  SELECT json(coalesce(json_group_array(DISTINCT m.new), '[]'))
  FROM json_each(review_decisions.corrected_fields, '$.tags') j JOIN tag_map m ON m.old = lower(trim(j.value))
))
WHERE corrected_fields IS NOT NULL AND json_type(corrected_fields, '$.tags') = 'array';

DROP TABLE tag_map;
