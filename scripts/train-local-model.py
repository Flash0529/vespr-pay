#!/usr/bin/env python3
"""
VESPR Local GPU Model Trainer & Dataset Engine
Allows the team to take data retained from free personal and corporate accounts,
inspect and format training corpora, and train proprietary models using his local PC graphics card.

Usage:
  python3 tools/train-local-model.py --inspect
  python3 tools/train-local-model.py --export-hf data/train.jsonl
  python3 tools/train-local-model.py --generate-script
  python3 tools/train-local-model.py --modelfile qwen2.5-coder:14b
"""

import argparse
import json
import os
import sys
from pathlib import Path

DEFAULT_DATASET = os.environ.get(
    "VESPR_DATASET_PATH",
    str(Path(os.environ.get("HOME", ".")) / "murmio-data" / "training" / "dataset.jsonl")
)

def inspect_dataset(path):
    p = Path(path)
    if not p.exists():
        print(f"[!] Dataset file not found at: {p}")
        print("    No training samples collected yet. Free tier interactions will populate this file.")
        return

    total = 0
    total_chars = 0
    languages = {}
    plans = {}

    with open(p, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            total += 1
            try:
                item = json.loads(line)
                total_chars += item.get("metadata", {}).get("char_count", 0)
                lang = item.get("language", "other")
                languages[lang] = languages.get(lang, 0) + 1
                plan = item.get("plan", "free")
                plans[plan] = plans.get(plan, 0) + 1
            except Exception:
                pass

    print("=" * 60)
    print("  VESPR PROPRIETARY TRAINING CORPUS (LOCAL GPU ENGINE)")
    print("=" * 60)
    print(f"Dataset path       : {p}")
    print(f"Total training pairs: {total:,}")
    print(f"Estimated tokens   : ~{int(total_chars / 4):,}")
    print(f"Total characters   : {total_chars:,}")
    print("\nPlan Distribution:")
    for plan, count in plans.items():
        pct = (count / total * 100) if total else 0
        print(f"  - {plan:<18}: {count:,} ({pct:.1f}%)")
    print("\nProgramming Language Distribution:")
    for lang, count in sorted(languages.items(), key=lambda x: -x[1])[:10]:
        pct = (count / total * 100) if total else 0
        print(f"  - {lang:<18}: {count:,} ({pct:.1f}%)")
    print("=" * 60)

def export_huggingface(src_path, dest_path):
    src = Path(src_path)
    dest = Path(dest_path)
    dest.parent.mkdir(parents=True, exist_ok=True)

    if not src.exists():
        print(f"[!] Source dataset not found: {src}")
        return

    count = 0
    with open(src, "r", encoding="utf-8") as fin, open(dest, "w", encoding="utf-8") as fout:
        for line in fin:
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line)
                msgs = raw.get("messages", [])
                system = next((m["content"] for m in msgs if m["role"] == "system"), "")
                user = next((m["content"] for m in msgs if m["role"] == "user"), "")
                assistant = next((m["content"] for m in msgs if m["role"] == "assistant"), "")

                hf_item = {
                    "instruction": user,
                    "input": system,
                    "output": assistant,
                    "language": raw.get("language", "python"),
                    "plan": raw.get("plan", "free")
                }
                fout.write(json.dumps(hf_item) + "\n")
                count += 1
            except Exception:
                pass

    print(f"[✓] Exported {count:,} training samples in Alpaca/HuggingFace format to: {dest}")

def generate_lora_train_script(dest_path="train_local_gpu.py"):
    script = '''#!/usr/bin/env python3
"""
VESPR Local GPU Fine-Tuner (QLoRA / PyTorch)
Trained on NVIDIA RTX GPU using bitsandbytes 4-bit quantization and LoRA.
Run directly on the teamsGamingPc.
"""

import os
import torch
from datasets import load_dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    TrainingArguments
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from trl import SFTTrainer

MODEL_ID = os.environ.get("BASE_MODEL", "Qwen/Qwen2.5-Coder-14B-Instruct")
DATA_FILE = os.environ.get("DATA_FILE", "train.jsonl")
OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "./vespr-trained-weights")

def main():
    print(f"=== Starting VESPR Local Model Training on GPU ===")
    print(f"CUDA available: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"GPU Device: {torch.cuda.get_device_name(0)}")

    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True
    )

    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, trust_remote_code=True)
    tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        quantization_config=bnb_config,
        device_map="auto",
        trust_remote_code=True
    )
    model = prepare_model_for_kbit_training(model)

    peft_config = LoraConfig(
        r=16,
        lora_alpha=32,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
    )
    model = get_peft_model(model, peft_config)
    model.print_trainable_parameters()

    dataset = load_dataset("json", data_files=DATA_FILE, split="train")

    def format_prompt(example):
        return f"<|im_start|>system\\n{example['input']}<|im_end|>\\n<|im_start|>user\\n{example['instruction']}<|im_end|>\\n<|im_start|>assistant\\n{example['output']}<|im_end|>"

    training_args = TrainingArguments(
        output_dir=OUTPUT_DIR,
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        learning_rate=2e-4,
        logging_steps=10,
        num_train_epochs=3,
        optim="paged_adamw_8bit",
        fp16=not torch.cuda.is_bf16_supported(),
        bf16=torch.cuda.is_bf16_supported(),
        save_strategy="epoch"
    )

    trainer = SFTTrainer(
        model=model,
        train_dataset=dataset,
        peft_config=peft_config,
        formatting_func=format_prompt,
        max_seq_length=2048,
        tokenizer=tokenizer,
        args=training_args
    )

    print("Beginning training loop...")
    trainer.train()
    trainer.model.save_pretrained(OUTPUT_DIR)
    print(f"[✓] LoRA adapters saved to {OUTPUT_DIR}")

if __name__ == "__main__":
    main()
'''
    with open(dest_path, "w", encoding="utf-8") as f:
        f.write(script.strip() + "\n")
    print(f"[✓] Generated PyTorch GPU training script: {dest_path}")

def generate_ollama_modelfile(base_model, dest_path="Modelfile.vespr-trained"):
    content = f'''# VESPR Proprietary Trained Model
# Fine-tuned on authentic multi-agent developer workflows from free tier corpora

FROM {base_model}

# Custom system instructions reflecting VESPR pair-programming standards
SYSTEM """You are VESPR Coder, an elite autonomous agent pair programmer.
You write production-grade, bug-free code with explicit test assertions and clear explanations.
You maintain architectural integrity, avoid placeholder mocks, and follow strict diff formats."""

PARAMETER temperature 0.2
PARAMETER top_p 0.95
PARAMETER stop "<|im_end|>"
PARAMETER stop "<|endoftext|>"
'''
    with open(dest_path, "w", encoding="utf-8") as f:
        f.write(content.strip() + "\n")
    print(f"[✓] Generated Ollama Modelfile: {dest_path}")
    print(f"    Build locally with: ollama create vespr-coder:latest -f {dest_path}")

def main():
    parser = argparse.ArgumentParser(description="VESPR Local GPU Model Trainer & Dataset Tool")
    parser.add_argument("--dataset", default=DEFAULT_DATASET, help="Path to dataset.jsonl")
    parser.add_argument("--inspect", action="store_true", help="Inspect training corpus metrics")
    parser.add_argument("--export-hf", metavar="DEST", help="Export in HuggingFace format")
    parser.add_argument("--generate-script", action="store_true", help="Generate local PyTorch GPU training script")
    parser.add_argument("--modelfile", metavar="BASE_MODEL", help="Generate Ollama Modelfile from base model")

    args = parser.parse_args()

    if len(sys.argv) == 1 or args.inspect:
        inspect_dataset(args.dataset)
    if args.export_hf:
        export_huggingface(args.dataset, args.export_hf)
    if args.generate_script:
        generate_lora_train_script()
    if args.modelfile:
        generate_ollama_modelfile(args.modelfile)

if __name__ == "__main__":
    main()
