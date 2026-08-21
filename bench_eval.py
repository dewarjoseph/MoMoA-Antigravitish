import sys

def main():
    alpha = float(sys.argv[1]) if len(sys.argv) > 1 else 1.0
    beta = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
    loss = (alpha - 0.5)**2 + (beta - 0.2)**2
    print("[OPTIMIZER_METRIC]: " + str(loss))

if __name__ == "__main__":
    main()
