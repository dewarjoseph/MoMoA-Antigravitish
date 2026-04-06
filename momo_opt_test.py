import os

def evaluate():
    # We are simulating a parameter tuning job against MoMo
    # where chunk_size and threads are dynamically injected by the optimizer
    chunk_size = int(os.environ.get('chunk_size', '100'))
    threads = int(os.environ.get('threads', '1'))
    
    # We'll build a synthetic scoring function that peaks when
    # chunk_size is 500 and threads is 4.
    score = 0
    if chunk_size == 500:
        score += 50
    elif chunk_size == 1000:
        score += 25
        
    if threads == 4:
        score += 50
    elif threads == 2:
        score += 20
        
    return score
