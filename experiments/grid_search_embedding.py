import math
import random
import itertools

def hash_embedding(text, prime, d_iters, decay_penalty):
    embedding = [0.0] * 768
    words = text.lower().split()
    for w, word in enumerate(words):
        h = 0
        for char in word:
            h = ((h << 5) - h + ord(char)) & 0xFFFFFFFF
            if h > 0x7FFFFFFF:
                h -= 0x100000000
                
        for d in range(int(d_iters)):
            idx = abs((h + d * int(prime)) % 768)
            sign = 1 if h > 0 else -1
            embedding[idx] += sign * (1.0 / ((w + 1) ** float(decay_penalty)))
            
    norm = math.sqrt(sum(v*v for v in embedding))
    if norm > 0:
        embedding = [v/norm for v in embedding]
    return embedding

def cosine_similarity(a, b):
    return sum(x*y for x, y in zip(a, b))

def evaluate(prime, d_iters, decay_penalty, seed=42):
    random.seed(seed)
    
    vocab = ["system", "agent", "memory", "retrieve", "swarm", "worker", "architecture", 
             "framework", "module", "execute", "tool", "dispatch", "jules", 
             "overseer", "prompt", "synthesis", "ast", "optimize"]
             
    vectors = []
    for _ in range(100):
        length = random.randint(4, 12)
        text = " ".join([random.choice(vocab) for _ in range(length)])
        vectors.append(hash_embedding(text, prime, d_iters, decay_penalty))
        
    total_abs_sim = 0.0
    pairs = 0
    for i in range(len(vectors)):
        for j in range(i+1, len(vectors)):
            sim = cosine_similarity(vectors[i], vectors[j])
            total_abs_sim += abs(sim)
            pairs += 1
            
    return total_abs_sim / pairs

if __name__ == "__main__":
    search_space = {
        "prime": [31, 97, 137, 251, 997],
        "d_iters": [8, 16, 32],
        "decay_penalty": [0.5, 1.0, 1.5, 2.0]
    }
    
    best_score = float('inf')
    best_params = {}
    
    print("Executing Python Grid Search Optimizer...")
    keys, values = zip(*search_space.items())
    for combination in itertools.product(*values):
        params = dict(zip(keys, combination))
        
        # 3 Trials for stability
        scores = []
        for t in range(3):
            score = evaluate(params['prime'], params['d_iters'], params['decay_penalty'], seed=42+t)
            scores.append(score)
            
        mean_score = sum(scores) / len(scores)
        if mean_score < best_score:
            best_score = mean_score
            best_params = params
            print("New Best -> Score: {0:.6f} | Params: {1}".format(best_score, best_params))
            
    print("-" * 40)
    print("Optimization Complete")
    print("Optimal Heuristics -> {0}".format(best_params))
    print("Baseline (prime=97, d_iters=8, decay_penalty=1.0) -> {0:.6f}".format(evaluate(97, 8, 1.0)))
    print("Optimized Minimal Deviation -> {0:.6f}".format(best_score))
