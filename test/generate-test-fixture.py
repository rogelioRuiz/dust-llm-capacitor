#!/usr/bin/env python3
from __future__ import annotations

import sys
import types
from pathlib import Path
import shutil

import numpy as np


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    llama_cpp_root = repo_root.parent / "dust-llm-swift" / "native" / "llama.cpp"
    sys.path.insert(0, str(llama_cpp_root / "gguf-py"))

    sentencepiece_stub = types.ModuleType("sentencepiece")

    class SentencePieceProcessor:  # pragma: no cover - import shim only
        pass

    sentencepiece_stub.SentencePieceProcessor = SentencePieceProcessor
    sys.modules.setdefault("sentencepiece", sentencepiece_stub)

    import gguf  # type: ignore

    output_path = repo_root / "test" / "fixtures" / "tiny-test.gguf"
    swift_fixture_path = repo_root.parent / "dust-llm-swift" / "Tests" / "DustLlmTests" / "Fixtures" / "tiny-test.gguf"
    writer = gguf.GGUFWriter(output_path, "llama")

    writer.add_name("tiny-test-model")
    writer.add_string(
        "tokenizer.chat_template",
        "{% for message in messages %}{{ message.content }}{% endfor %}",
    )
    writer.add_block_count(1)
    writer.add_context_length(64)
    writer.add_embedding_length(64)
    writer.add_feed_forward_length(128)
    writer.add_head_count(4)
    writer.add_head_count_kv(4)
    writer.add_layer_norm_rms_eps(1.0e-5)
    writer.add_rope_dimension_count(16)
    writer.add_file_type(0)
    writer.add_uint32("clip.vision.image_size", 224)
    writer.add_tokenizer_model("llama")

    tokens = [f"tok_{index}" for index in range(32)]
    scores = [0.0] * len(tokens)
    token_types = [gguf.TokenType.NORMAL] * len(tokens)
    writer.add_token_list(tokens)
    writer.add_token_scores(scores)
    writer.add_token_types(token_types)
    writer.add_bos_token_id(1)
    writer.add_eos_token_id(2)
    writer.add_unk_token_id(0)

    writer.add_tensor("token_embd.weight", np.zeros((32, 64), dtype=np.float32))
    writer.add_tensor("output_norm.weight", np.ones((64,), dtype=np.float32))
    writer.add_tensor("output.weight", np.zeros((32, 64), dtype=np.float32))
    writer.add_tensor("blk.0.attn_norm.weight", np.ones((64,), dtype=np.float32))
    writer.add_tensor("blk.0.ffn_norm.weight", np.ones((64,), dtype=np.float32))
    writer.add_tensor("blk.0.attn_q.weight", np.zeros((64, 64), dtype=np.float32))
    writer.add_tensor("blk.0.attn_k.weight", np.zeros((64, 64), dtype=np.float32))
    writer.add_tensor("blk.0.attn_v.weight", np.zeros((64, 64), dtype=np.float32))
    writer.add_tensor("blk.0.attn_output.weight", np.zeros((64, 64), dtype=np.float32))
    writer.add_tensor("blk.0.ffn_gate.weight", np.zeros((128, 64), dtype=np.float32))
    writer.add_tensor("blk.0.ffn_down.weight", np.zeros((64, 128), dtype=np.float32))
    writer.add_tensor("blk.0.ffn_up.weight", np.zeros((128, 64), dtype=np.float32))

    writer.write_header_to_file()
    writer.write_kv_data_to_file()
    writer.write_tensors_to_file()
    writer.close()

    swift_fixture_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(output_path, swift_fixture_path)


if __name__ == "__main__":
    main()
