"""Create persistent global Coach conversations and messages.

Run from the backend directory after deploying the model changes.
The statements are idempotent so they are safe to run more than once.
"""
from sqlalchemy import text

from app.database import engine


STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS chat_conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(160) NOT NULL DEFAULT 'Neuer Chat',
        summary VARCHAR(12000),
        summary_until_sequence INTEGER,
        next_sequence INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS chat_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        role VARCHAR(16) NOT NULL,
        content VARCHAR(16000) NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'completed',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_chat_message_sequence UNIQUE (conversation_id, sequence)
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_chat_conversations_user_id ON chat_conversations (user_id);",
    "CREATE INDEX IF NOT EXISTS ix_chat_conversations_user_updated ON chat_conversations (user_id, updated_at);",
    "CREATE INDEX IF NOT EXISTS ix_chat_messages_conversation_id ON chat_messages (conversation_id);",
    "CREATE INDEX IF NOT EXISTS ix_chat_messages_conversation_sequence ON chat_messages (conversation_id, sequence);",
]


if __name__ == "__main__":
    with engine.begin() as connection:
        for statement in STATEMENTS:
            connection.execute(text(statement))
    print("Chat conversation tables are ready.")
