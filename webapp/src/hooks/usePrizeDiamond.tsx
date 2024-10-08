import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { EncryptedUint32, FhenixClient } from "fhenixjs";
import { useCallback } from "react";
import toast from "react-hot-toast";
import { Address, Hash } from "viem";
import { useBlockNumber, usePublicClient, useWriteContract } from "wagmi";
import { config } from "../config";
import { useWalletContext } from "../contexts/WalletContext";
import { AllocationStrategy, PrizeDetails, PrizeParams, State } from "../lib/types";

type AbiFunction = {
  type: "function";
  name: string;
  inputs: any[];
  outputs: any[];
  stateMutability: string;
};

const diamondAbi = config.contracts.Diamond.abi as AbiFunction[];

type DiamondFunctionName = Extract<(typeof diamondAbi)[number], { type: "function" }>["name"];

const convertToAllocationStrategy = (strategy: number): AllocationStrategy => {
  switch (strategy) {
    case 0:
      return AllocationStrategy.Linear;
    case 1:
      return AllocationStrategy.Quadratic;
    case 2:
      return AllocationStrategy.Invalid;
    default:
      throw new Error("Invalid allocation strategy");
  }
};

export const usePrizeDiamond = (fhenixClient: FhenixClient | null) => {
  const queryClient = useQueryClient();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { data: blockNumber } = useBlockNumber({ watch: true });
  const { address, isConnected, walletClient } = useWalletContext();

  const diamondAddress = config.contracts.Diamond.address;

  const readDiamond = useCallback(
    async <T extends DiamondFunctionName>(functionName: T, args: any[]): Promise<any> => {
      try {
        if (!publicClient) {
          throw new Error("Public client is not available");
        }
        const data = await publicClient.readContract({
          address: diamondAddress as Address,
          abi: diamondAbi,
          functionName,
          args,
        });
        return data;
      } catch (error) {
        console.error(`Error reading from Diamond.${functionName}:`, error);
        throw error;
      }
    },
    [publicClient, diamondAddress],
  );

  const useReadDiamond = useCallback(
    <T extends DiamondFunctionName>(functionName: T) =>
      useCallback((...args: any[]) => readDiamond(functionName, args), [readDiamond, functionName]),
    [readDiamond],
  );

  const getState = useReadDiamond("getState");
  const isPrizeEvaluator = useReadDiamond("isPrizeEvaluator");
  const getPrizeEvaluatorCount = useReadDiamond("getPrizeEvaluatorCount");
  const getContributionCount = useReadDiamond("getContributionCount");
  const getContribution = useReadDiamond("getContribution");
  const getContributionByIndex = useReadDiamond("getContributionByIndex");
  const getContributionIdsForContestant = useReadDiamond("getContributionIdsForContestant");
  const getEvaluationCount = useReadDiamond("getEvaluationCount");
  const hasEvaluatorScoredContribution = useReadDiamond("hasEvaluatorScoredContribution");
  const getCriteriaWeights = useReadDiamond("getCriteriaWeights");
  const getAllAllocationStrategies = useReadDiamond("getAllAllocationStrategies");
  const getAllocationStrategy = useReadDiamond("getAllocationStrategy");
  const getPrizeEvaluators = useReadDiamond("getPrizeEvaluators");

  const getPrizeCount = useCallback(async (): Promise<bigint> => {
    const count: bigint = await readDiamond("getPrizeCount", []);
    return count;
  }, [readDiamond]);

  const getPrizeDetails = useCallback(
    async (prizeId: bigint): Promise<PrizeDetails> => {
      const cacheKey = ["prizeDetails", prizeId.toString()];
      const cachedPrize = queryClient.getQueryData<PrizeDetails>(cacheKey);
      if (cachedPrize) {
        return cachedPrize;
      }
      try {
        const details = await readDiamond("getPrizeDetails", [prizeId.toString()]);
        console.log("Prize details fetched:", details);

        const prizeDetails: PrizeDetails = {
          id: BigInt(details.id),
          organizer: details.organizer as Address,
          name: details.name as string,
          description: details.description as string,
          monetaryRewardPool: BigInt(details.monetaryRewardPool),
          fundedAmount: BigInt(details.fundedAmount),
          state: details.state as State,
          criteriaNames: details.criteriaNames as string[],
          criteriaWeights: details.criteriaWeights as number[],
          createdAt: BigInt(details.createdAt),
          strategy: convertToAllocationStrategy(details.strategy),
          contributionCount: BigInt(details.contributionCount),
          evaluatedContributionsCount: Number(details.evaluatedContributionsCount),
          claimedRewardsCount: Number(details.claimedRewardsCount),
          rewardsAllocated: details.rewardsAllocated as boolean,
          lastProcessedIndex: details.lastProcessedIndex || 0n,
        };

        queryClient.setQueryData(cacheKey, prizeDetails);
        return prizeDetails;
      } catch (error) {
        console.error(`Error fetching details for prize ${prizeId}:`, error);
        throw error;
      }
    },
    [readDiamond, queryClient],
  );

  const usePrizeDetails = (prizeIds: bigint[]) => {
    return useQueries({
      queries: prizeIds.map((id) => ({
        queryKey: ["prizeDetails", id.toString()],
        queryFn: () => getPrizeDetails(id),
        staleTime: 30000,
        cacheTime: 60000,
      })),
    });
  };

  const getPrizes = useCallback(
    async (startIndex: bigint, count: bigint): Promise<PrizeDetails[]> => {
      const cachedPrizes = queryClient.getQueryData<PrizeDetails[]>(["allPrizes"]);

      if (cachedPrizes) {
        const start = Number(startIndex);
        const end = Math.min(start + Number(count), cachedPrizes.length);
        return cachedPrizes.slice(start, end);
      }

      try {
        const prizeCount = await getPrizeCount();
        if (prizeCount === 0n) {
          return [];
        }

        if (startIndex >= prizeCount) {
          return [];
        }

        const actualCount = count > prizeCount - startIndex ? prizeCount - startIndex : count;
        const rawPrizes = await readDiamond("getPrizes", [startIndex.toString(), actualCount.toString()]);

        if (!Array.isArray(rawPrizes)) {
          throw new Error("Expected getPrizes to return an array");
        }

        const detailedPrizes = await Promise.all(
          rawPrizes.map(async (prize: any): Promise<PrizeDetails> => {
            const prizeId = BigInt(prize.id);
            try {
              return await getPrizeDetails(prizeId);
            } catch (error) {
              console.error(`Error fetching details for prize ${prizeId}:`, error);
              throw error;
            }
          }),
        );

        return detailedPrizes;
      } catch (error) {
        console.error("Error fetching prizes:", error);
        throw error;
      }
    },
    [readDiamond, getPrizeDetails, getPrizeCount, queryClient],
  );

  const getContestants = useCallback(
    async (prizeId: bigint): Promise<Address[]> => {
      try {
        const contributionCount: bigint = await getContributionCount(prizeId);
        const contestantsSet = new Set<Address>();

        for (let i = 0n; i < contributionCount; i++) {
          const [contestant] = await getContributionByIndex(prizeId, i);
          if (contestant) {
            contestantsSet.add(contestant as Address);
          }
        }

        return Array.from(contestantsSet);
      } catch (error) {
        console.error(`Error fetching contestants for prize ${prizeId}:`, error);
        throw error;
      }
    },
    [getContributionCount, getContributionByIndex],
  );

  const fundTotally = useMutation<string, Error, { prizeId: bigint; amount: bigint }>({
    mutationFn: async ({ prizeId, amount }) => {
      if (!walletClient) throw new Error("Wallet not connected");
      return writeContractAsync({
        address: diamondAddress as Address,
        abi: diamondAbi,
        functionName: "fundTotally",
        args: [prizeId.toString()],
        value: amount,
      });
    },
    onSuccess: (_, { prizeId, amount }) => {
      queryClient.setQueryData<PrizeDetails | undefined>(["prizeDetails", prizeId.toString()], (oldData) => {
        if (!oldData) return undefined;
        return {
          ...oldData,
          fundedAmount: oldData.fundedAmount + amount,
        };
      });
      queryClient.invalidateQueries({ queryKey: ["prizeDetails", prizeId.toString()] });
      toast.success("Prize funded successfully");
    },
    onError: (error) => {
      console.error("Error funding prize:", error);
      toast.error(`Failed to fund prize: ${error.message}`);
    },
  });

  const setAllocationStrategy = useMutation<string, Error, { prizeId: bigint; strategy: AllocationStrategy }>({
    mutationFn: async ({ prizeId, strategy }) => {
      if (!walletClient) throw new Error("Wallet not connected");
      return writeContractAsync({
        address: diamondAddress as Address,
        abi: diamondAbi,
        functionName: "setAllocationStrategy",
        args: [prizeId.toString(), strategy],
      });
    },
    onSuccess: (_, { prizeId }) => {
      queryClient.invalidateQueries({ queryKey: ["prizeDetails", prizeId.toString()] });
      toast.success("Allocation strategy updated successfully");
    },
    onError: (error) => {
      console.error("Error setting allocation strategy:", error);
      toast.error(`Failed to set allocation strategy: ${error.message}`);
    },
  });

  const assignCriteriaWeights = useMutation<string, Error, { prizeId: bigint; weights: number[] }>({
    mutationFn: async ({ prizeId, weights }) => {
      if (!walletClient) throw new Error("Wallet not connected");
      return writeContractAsync({
        address: diamondAddress as Address,
        abi: diamondAbi,
        functionName: "assignCriteriaWeights",
        args: [prizeId.toString(), weights],
      });
    },
    onSuccess: (_, { prizeId }) => {
      queryClient.invalidateQueries({ queryKey: ["prizeDetails", prizeId.toString()] });
    },
    onError: (error) => {
      console.error("Error assigning criteria weights:", error);
    },
  });

  const createPrize = useMutation<string, Error, PrizeParams>({
    mutationFn: async (prizeParams) => {
      if (!walletClient) throw new Error("Wallet not connected");
      const txHash = await writeContractAsync({
        address: diamondAddress as Address,
        abi: diamondAbi,
        functionName: "createPrize",
        args: [
          {
            name: prizeParams.name,
            description: prizeParams.description,
            pool: prizeParams.pool,
            criteria: prizeParams.criteria,
            criteriaWeights: prizeParams.criteriaWeights,
            strategy: prizeParams.strategy,
          },
        ],
      });
      return txHash;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prizes"] });
    },
    onError: (error) => {
      console.error("Error creating prize:", error);
      toast.error(`Failed to create prize: ${error.message}`);
    },
  });

  const submitContribution = useMutation<string, Error, { prizeId: bigint; description: string }>({
    mutationFn: async ({ prizeId, description }) => {
      if (!isConnected || !address) throw new Error("Wallet not connected");
      return writeContractAsync({
        address: diamondAddress as Address,
        abi: diamondAbi,
        functionName: "submitContribution",
        args: [prizeId.toString(), description],
      });
    },
    onSuccess: (_, { prizeId }) => {
      queryClient.invalidateQueries({ queryKey: ["prizeDetails", prizeId.toString()] });
      toast.success("Contribution submitted successfully");
    },
    onError: (error) => {
      console.error("Error submitting contribution:", error);
      toast.error(`Failed to submit contribution: ${error.message}`);
    },
  });

  const moveToNextState = useMutation<string, Error, { prizeId: bigint }>({
    mutationFn: async ({ prizeId }) => {
      if (!walletClient) throw new Error("Wallet not connected");
      return writeContractAsync({
        address: diamondAddress as Address,
        abi: diamondAbi,
        functionName: "moveToNextState",
        args: [prizeId],
      });
    },
    onSuccess: (_, { prizeId }) => {
      queryClient.invalidateQueries({ queryKey: ["prizeDetails", prizeId.toString()] });
      toast.success("Prize state updated successfully");
    },
    onError: (error) => {
      console.error("Error updating prize state:", error);
      toast.error(`Failed to update prize state: ${error.message}`);
    },
  });

  const waitForTransaction = useCallback(
    async (hash: Hash): Promise<void> => {
      try {
        if (!publicClient) throw new Error("Public client is not available");
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (!receipt) throw new Error("Transaction receipt not found");
      } catch (error) {
        console.error("Error waiting for transaction:", error);
        throw error;
      }
    },
    [publicClient],
  );

  const canEvaluate = useCallback(
    async (prizeId: bigint): Promise<boolean> => {
      if (!isConnected || !address) {
        console.error("Wallet not connected or address is undefined");
        toast.error("Please connect your wallet to perform this action.");
        return false;
      }

      try {
        const [isEvaluator, prizeState] = await Promise.all([
          readDiamond("isPrizeEvaluator", [prizeId.toString(), address]),
          getState(prizeId),
        ]);

        if (!isEvaluator) {
          toast.error("You are not an evaluator for this prize.");
          return false;
        }

        if (prizeState !== State.Evaluating) {
          toast.error("This prize is not in the evaluation state.");
          return false;
        }

        return true;
      } catch (error) {
        console.error("Error checking if address can evaluate:", error);
        toast.error("Failed to verify evaluator status or prize state.");
        return false;
      }
    },
    [readDiamond, getState, address, isConnected],
  );

  const isPrizeOrganizer = async (prizeId: bigint, address: Address): Promise<boolean> => {
    try {
      const prizeDetails = await getPrizeDetails(prizeId);
      return prizeDetails.organizer.toLowerCase() === address.toLowerCase();
    } catch (error) {
      console.error("Error checking if address is prize organizer:", error);
      throw error;
    }
  };

  const addEvaluatorsAsync = useCallback(
    async ({ prizeId, evaluators }: { prizeId: bigint; evaluators: Address[] }) => {
      await writeContractAsync({
        address: diamondAddress as Address,
        abi: diamondAbi,
        functionName: "addEvaluators",
        args: [prizeId.toString(), evaluators],
      });
    },
    [writeContractAsync, diamondAddress, diamondAbi],
  );

  const getEvaluatedContributions = useCallback(
    async (prizeId: bigint, evaluator: Address): Promise<bigint[]> => {
      const contributionCount = await getContributionCount(prizeId);
      const evaluatedContributions: bigint[] = [];

      for (let i = 0n; i < contributionCount; i++) {
        const hasScored = await hasEvaluatorScoredContribution(prizeId, evaluator, i);
        if (hasScored) {
          evaluatedContributions.push(i);
        }
      }

      return evaluatedContributions;
    },
    [getContributionCount, hasEvaluatorScoredContribution],
  );

  const getAllocationDetails = useCallback(
    async (
      prizeId: bigint,
    ): Promise<{ lastProcessedIndex: bigint; contributionCount: bigint; rewardsAllocated: boolean }> => {
      const prizeDetails = await getPrizeDetails(prizeId);
      return {
        lastProcessedIndex: prizeDetails.lastProcessedIndex,
        contributionCount: prizeDetails.contributionCount,
        rewardsAllocated: prizeDetails.rewardsAllocated,
      };
    },
    [getPrizeDetails],
  );

  const hasClaimableReward = useCallback(
    async (prizeId: bigint, address: Address): Promise<boolean> => {
      try {
        const prizeDetails = await getPrizeDetails(prizeId);
        if (prizeDetails.state !== State.Claiming || !prizeDetails.rewardsAllocated) {
          return false;
        }
        const contributionIds = await getContributionIdsForContestant(prizeId, address);
        return contributionIds.length > 0;
      } catch (error) {
        console.error("Error checking for claimable reward:", error);
        return false;
      }
    },
    [getPrizeDetails, getContributionIdsForContestant],
  );

  function formatForContractCall(encryptedString: EncryptedUint32[]): { data: Hash }[] {
    return encryptedString.map((encNum) => ({ data: `0x${Buffer.from(encNum.data).toString("hex")}` }));
  }

  const evaluateContribution = useMutation<
    void,
    Error,
    { prizeId: bigint; contributionId: bigint; encryptedScores: EncryptedUint32[] }
  >({
    mutationFn: async ({ prizeId, contributionId, encryptedScores }) => {
      if (!walletClient) throw new Error("Wallet not connected");

      const encryptedScoresHex = formatForContractCall(encryptedScores);

      await writeContractAsync({
        address: diamondAddress as Address,
        abi: diamondAbi,
        functionName: "evaluateContribution",
        args: [prizeId, contributionId, encryptedScoresHex],
      });
    },
    onSuccess: (_, { prizeId }) => {
      queryClient.invalidateQueries({ queryKey: ["prizeDetails", prizeId.toString()] });
      toast.success("Contribution evaluated successfully");
    },
    onError: (error) => {
      console.error("Error evaluating contribution:", error);
      toast.error(`Failed to evaluate contribution: ${error.message}`);
    },
  });

  const computeContestantClaimReward = useMutation<string, Error, { prizeId: bigint }>({
    mutationFn: async ({ prizeId }) => {
      if (!walletClient) throw new Error("Wallet not connected");

      console.log(`📝 Attempting to compute contestant claim reward for Prize ID: ${prizeId.toString()}`);
      console.log(`🔍 Fetching prize details...`);

      try {
        // Fetch prize details
        const prizeDetails = await getPrizeDetails(prizeId);
        console.log(`📄 Prize Details:`, prizeDetails);

        // Validate Prize State
        if (prizeDetails.state !== State.Claiming) {
          throw new Error(`❌ Invalid prize state: ${prizeDetails.state}. Expected: ${State.Claiming}`);
        }

        // Check Rewards Allocation
        if (!prizeDetails.rewardsAllocated) {
          throw new Error("❌ Rewards have not been allocated yet");
        }

        // Verify User's Contributions
        const contributionIds = await getContributionIdsForContestant(prizeId, address);
        console.log(`🔢 Contribution IDs for User:`, contributionIds);

        if (contributionIds.length === 0) {
          throw new Error("❌ No contributions found for this prize");
        }

        // Proceed with contract call
        const txHash = await writeContractAsync({
          address: diamondAddress as Address,
          abi: diamondAbi,
          functionName: "computeContestantClaimReward",
          args: [prizeId.toString()],
        });

        console.log(`✅ Transaction submitted successfully. Hash: ${txHash}`);
        return txHash;
      } catch (error: any) {
        console.error(`⚠️ Error in computeContestantClaimReward:`, error);
        throw error;
      }
    },
    onSuccess: (_, { prizeId }) => {
      console.log(`🎉 Contestant rewards computed successfully for Prize ID: ${prizeId.toString()}`);
      queryClient.invalidateQueries({ queryKey: ["prizeDetails", prizeId.toString()] });
      toast.success("Contestant rewards computed successfully");
    },
    onError: (error, { prizeId }) => {
      console.error(`❗ Error computing contestant rewards for Prize ID ${prizeId.toString()}:`, error);
      toast.error(`Failed to compute contestant rewards: ${error.message}`);
    },
  });

  const allocateRewardsBatch = useMutation<void, Error, { prizeId: bigint; batchSize: bigint }>({
    mutationFn: async ({ prizeId, batchSize }) => {
      if (!writeContractAsync) throw new Error("Write contract function is unavailable");

      await writeContractAsync({
        address: diamondAddress as Address,
        abi: diamondAbi,
        functionName: "allocateRewardsBatch",
        args: [prizeId, batchSize.toString()],
      });
    },
    onSuccess: (_, { prizeId }) => {
      queryClient.invalidateQueries({ queryKey: ["prizeDetails", prizeId.toString()] });
      toast.success("Rewards allocated successfully");
    },
    onError: (error) => {
      console.error("Error allocating rewards:", error);
      toast.error(`Failed to allocate rewards: ${error.message}`);
    },
  });

  const areAllRewardsClaimed = useCallback(
    async (prizeId: bigint): Promise<boolean> => {
      return readDiamond("areAllRewardsClaimed", [prizeId.toString()]);
    },
    [readDiamond],
  );

  const updateClaimStatus = useMutation<string, Error, { prizeId: bigint }>({
    mutationFn: async ({ prizeId }) => {
      if (!walletClient) throw new Error("Wallet not connected");
      return writeContractAsync({
        address: diamondAddress as Address,
        abi: diamondAbi,
        functionName: "updateClaimStatus",
        args: [prizeId],
      });
    },
    onSuccess: (_, { prizeId }) => {
      queryClient.invalidateQueries({ queryKey: ["prizeDetails", prizeId.toString()] });
      toast.success("Claim status updated successfully");
    },
    onError: (error) => {
      console.error("Error updating claim status:", error);
      toast.error(`Failed to update claim status: ${error.message}`);
    },
  });

  const viewAndDecryptClaimedReward = useCallback(
    async (prizeId: bigint) => {
      console.log("Starting viewAndDecryptClaimedReward for prizeId:", prizeId.toString());
      console.log("Current wallet address:", address);

      if (!fhenixClient || !walletClient) {
        console.error("Fhenix client or wallet client is not available");
        throw new Error("Fhenix client or wallet client is not available");
      }

      try {
        console.log("Using wallet client as signer...");
        console.log("Wallet client address:", walletClient.account.address);

        console.log("Generating permit...");
        console.log("PrizeRewardFacet address:", config.contracts.PrizeRewardFacet.address);

        // Create a compatible signer object for FhenixClient
        const compatibleSigner = {
          getAddress: async () => walletClient.account.address,
          signTypedData: async (domain, types, value) => {
            return walletClient.signTypedData({
              domain,
              types,
              primaryType: "Permit",
              message: value,
            });
          },
        };

        const permit = await fhenixClient.generatePermit(
          config.contracts.PrizeRewardFacet.address,
          undefined,
          compatibleSigner,
        );

        console.log("Generated permit:", JSON.stringify(permit, null, 2));

        console.log("Extracting permit permission...");
        const permission = fhenixClient.extractPermitPermission(permit);
        console.log("Extracted permission:", permission);

        console.log("Calling viewContestantClaimReward...");
        const encryptedReward: string = await readDiamond("viewContestantClaimReward", [prizeId, permission]);
        console.log("Received encrypted reward:", encryptedReward);

        console.log("Unsealing reward...");
        const decryptedReward = fhenixClient.unseal(config.contracts.PrizeRewardFacet.address, encryptedReward);
        console.log("Decrypted reward:", decryptedReward);

        return decryptedReward;
      } catch (error) {
        console.error("Error in viewAndDecryptClaimedReward:", error);
        throw error;
      }
    },
    [fhenixClient, address, readDiamond, walletClient],
  );

  // const createPermitSigner = (signer: WalletClient): FhenixPermitSigner => {
  //   return {
  //     getAddress: async () => {
  //       const [address] = await signer.getAddresses();
  //       return address;
  //     },
  //     signTypedData: async (
  //       domain: TypedDataDomain,
  //       types: Record<string, Array<{ name: string; type: string }>>,
  //       value: Record<string, any>,
  //     ) => {
  //       const [address] = await signer.getAddresses();

  //       // Ensure that the types object includes the Permissioned type
  //       if (!types.Permissioned) {
  //         throw new Error("Permissioned type is missing from types object");
  //       }

  //       // Convert the domain object to the expected format
  //       const formattedDomain: TypedDataDomain = {
  //         name: domain.name,
  //         version: domain.version,
  //         chainId: domain.chainId,
  //         verifyingContract: domain.verifyingContract,
  //       };

  //       try {
  //         const signature = await signer.signTypedData({
  //           account: address,
  //           domain: formattedDomain,
  //           types,
  //           primaryType: "Permissioned",
  //           message: value,
  //         });
  //         return signature;
  //       } catch (error) {
  //         console.error("Error in signTypedData:", error);
  //         throw error;
  //       }
  //     },
  //   };
  // };

  const encryptScores = useCallback(
    async (scores: number[]): Promise<EncryptedUint32[]> => {
      if (!fhenixClient) throw new Error("FHE client is not available");
      return Promise.all(scores.map((score) => fhenixClient.encrypt_uint32(score)));
    },
    [fhenixClient],
  );

  return {
    addEvaluatorsAsync,
    allocateRewardsBatchAsync: allocateRewardsBatch.mutateAsync,
    areAllRewardsClaimed,
    assignCriteriaWeightsAsync: assignCriteriaWeights.mutateAsync,
    blockNumber: blockNumber ? Number(blockNumber) : undefined,
    canEvaluate,
    computeContestantClaimRewardAsync: computeContestantClaimReward.mutateAsync,
    createPrizeAsync: createPrize.mutateAsync,
    evaluateContributionAsync: evaluateContribution.mutateAsync,
    fundTotallyAsync: fundTotally.mutateAsync,
    getAllAllocationStrategies,
    getAllocationDetails,
    getAllocationStrategy,
    getContestants,
    getContribution,
    getContributionByIndex,
    getContributionCount,
    getContributionIdsForContestant,
    getCriteriaWeights,
    getEvaluatedContributions,
    getEvaluationCount,
    getPrizeCount,
    getPrizeDetails,
    getPrizeEvaluatorCount,
    getPrizeEvaluators,
    getPrizes,
    getState,
    hasClaimableReward,
    hasEvaluatorScoredContribution,
    isPrizeEvaluator,
    isPrizeOrganizer,
    encryptScores,
    moveToNextStateAsync: moveToNextState.mutateAsync,
    setAllocationStrategyAsync: setAllocationStrategy.mutateAsync,
    submitContributionAsync: submitContribution.mutateAsync,
    updateClaimStatusAsync: updateClaimStatus.mutateAsync,
    usePrizeDetails,
    viewAndDecryptClaimedReward,
    waitForTransaction,
    fhenixClient,
  } as const;
};

export type UsePrizeDiamondReturn = ReturnType<typeof usePrizeDiamond>;
