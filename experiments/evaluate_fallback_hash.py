import os
import math
import random

def hash_embedding(text, prime, d_iters, decay_penalty):
    embedding = [0.0] * 768
    words = text.lower().split()
    for w, word in enumerate(words):
        h = 0
        for char in word:
            h = ((h << 5) - h + ord(char)) & 0xFFFFFFFF
            # Interpret as signed 32-bit int
            if h > 0x7FFFFFFF:
                h -= 0x100000000
                
        for d in range(int(d_iters)):
            idx = abs((h + d * int(prime)) % 768)
            sign = 1 if h > 0 else -1
            embedding[idx] += sign * (1.0 / ((w + 1) ** float(decay_penalty)))
            
    # Normalize to unit vector
    norm = math.sqrt(sum(v*v for v in embedding))
    if norm > 0:
        embedding = [v/norm for v in embedding]
    return embedding

def cosine_similarity(a, b):
    # Since they are unit vectors, dot product is cosine similarity
    return sum(x*y for x, y in zip(a, b))

def evaluate():
    prime = int(os.environ.get("prime", 97))
    d_iters = int(os.environ.get("d_iters", 8))
    decay_penalty = float(os.environ.get("decay_penalty", 1.0))
    
    seed = int(os.environ.get("RANDOM_SEED", 42))
    random.seed(seed)
    
    vocab = ["system", "agent", "memory", "retrieve", "swarm", "worker", "architecture", 
             "framework", "module", "execute", "tool", "dispatch", "jules", 
             "overseer", "prompt", "synthesis", "ast", "optimize"]
             
    # Generate 100 randomly distinct sentences
    vectors = []
    for _ in range(100):
        length = random.randint(4, 12)
        text = " ".join(random.choices(vocab, k=length))
        vectors.append(hash_embedding(text, prime, d_iters, decay_penalty))
        
    total_abs_sim = 0.0
    pairs = 0
    for i in range(len(vectors)):
        for j in range(i+1, len(vectors)):
            sim = cosine_similarity(vectors[i], vectors[j])
            total_abs_sim += abs(sim)
            pairs += 1
            
    # We want to minimize the mean absolute deviation of similarities
    # (i.e. force similarities as close to 0 as possible for arbitrary random word clouds)
    mean_abs_sim = total_abs_sim / pairs
    return mean_abs_sim

if __name__ == "__main__":
    result = evaluate()
    print(f"[OPTIMIZER_METRIC]: {result}")
