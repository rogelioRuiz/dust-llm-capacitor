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
    gguf_py = llama_cpp_root / "gguf-py"

    if not gguf_py.is_dir():
        print(
            "ERROR: Could not find gguf-py at:\n"
            f"  {gguf_py}\n\n"
            "This script requires the dust-llm-swift repo cloned as a sibling:\n"
            "  git clone https://github.com/rogelioRuiz/dust-llm-swift.git "
            f"{repo_root.parent / 'dust-llm-swift'}\n"
            "  cd dust-llm-swift && git submodule update --init",
            file=sys.stderr,
        )
        sys.exit(1)

    sys.path.insert(0, str(gguf_py))

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

    if swift_fixture_path.parent.exists():
        shutil.copyfile(output_path, swift_fixture_path)
        print(f"Copied fixture to {swift_fixture_path}")
    else:
        print(
            f"Skipping Swift fixture copy (directory not found: {swift_fixture_path.parent})"
        )


if __name__ == "__main__":
    main()
