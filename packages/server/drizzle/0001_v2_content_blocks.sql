-- 0001_v2_content_blocks.sql
--
-- v2: Align messages schema with LangChain 1.2 v1 content block standard.
--   - `content` becomes JSON (was TEXT). Holds an array of ContentBlock
--     objects: text | reasoning | tool_call | tool_result | image.
--   - `parent_message_id` links tool_result messages to their tool_call.
--   - `status` tracks message lifecycle (pending/streaming/success/error/aborted).
--   - `usage` records token counts (input/output/total).
--   - `model` records which LLM produced the assistant message.
--   - `finish_reason` records why the model stopped (stop/tool_calls/length).
--   - `tool_calls` was already a JSON column; existing data may be NULL and
--     is backfilled with [] on read.
--
-- Safe to run on existing data: content is wrapped to a single text block;
-- NULL tool_calls stays NULL.

ALTER TABLE messages
  MODIFY COLUMN content JSON NOT NULL,
  ADD COLUMN parent_message_id VARCHAR(36) NULL AFTER tool_calls,
  ADD COLUMN status ENUM('pending','streaming','success','error','aborted')
    NOT NULL DEFAULT 'success' AFTER parent_message_id,
  ADD COLUMN model VARCHAR(64) NULL AFTER status,
  ADD COLUMN `usage` JSON NULL AFTER model,
  ADD COLUMN finish_reason VARCHAR(32) NULL AFTER `usage`,
  ADD CONSTRAINT fk_messages_parent_message
    FOREIGN KEY (parent_message_id) REFERENCES messages(id)
    ON DELETE SET NULL;

CREATE INDEX idx_messages_parent ON messages(parent_message_id);
CREATE INDEX idx_messages_status ON messages(session_id, status);
CREATE INDEX idx_messages_model  ON messages(session_id, model);
